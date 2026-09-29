-- HarboR Heatmap RPC

-- ============ 共通 ============
create or replace function public.hm_match(p_match text, p_pattern text, p_value text)
returns boolean language plpgsql immutable as $$
begin
  if p_value is null or p_pattern is null or p_pattern = '' then return false; end if;
  return case p_match
    when 'equals' then p_value = p_pattern
    when 'prefix' then left(p_value, length(p_pattern)) = p_pattern
    when 'regex' then p_value ~ p_pattern
    else position(p_pattern in p_value) > 0
  end;
exception when others then
  return false;
end $$;

-- サイトキーとOriginを検証してサイトを返す（計測タグ用）
create or replace function public.hm_site_for_key(p_key text)
returns public.hm_sites
language plpgsql stable security definer set search_path = public as $$
declare
  s public.hm_sites;
  origin text;
  host text;
  d text;
  ok boolean := false;
begin
  select * into s from public.hm_sites where site_key = p_key;
  if not found then raise exception 'invalid site key'; end if;
  if coalesce(array_length(s.domains, 1), 0) = 0 then return s; end if;
  origin := coalesce(current_setting('request.headers', true)::json ->> 'origin', '');
  host := lower(split_part(regexp_replace(origin, '^[a-z]+://', ''), ':', 1));
  if host = '' then raise exception 'origin required'; end if;
  foreach d in array s.domains loop
    d := lower(trim(d));
    if host = d or right(host, length(d) + 1) = '.' || d then ok := true; exit; end if;
  end loop;
  if not ok then raise exception 'origin not allowed'; end if;
  return s;
end $$;

create or replace function public.hm_require_member()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hm_is_member() then raise exception 'not allowed'; end if;
end $$;

-- ============ 計測タグ：設定取得 ============
create or replace function public.hm_config(p_key text, p_url text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.hm_sites;
  res jsonb;
begin
  s := public.hm_site_for_key(p_key);

  select jsonb_build_object(
    'site', s.id,
    'cv', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'type', t.type, 'match', t.match, 'pattern', t.pattern))
                    from public.hm_cv_tags t where t.site_id = s.id and t.enabled), '[]'),
    'popups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'kind', p.kind, 'priority', p.priority,
        'triggers', p.triggers, 'conditions', p.conditions, 'settings', p.settings, 'scenario', p.scenario,
        'creatives', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', c.id, 'type', c.type, 'image_url', c.image_url, 'html', c.html, 'link_url', c.link_url, 'alt', c.alt,
            'v', (select count(*) from public.hm_popup_events e where e.creative_id = c.id and e.event = 'view' and e.created_at > now() - interval '30 days'),
            'c', (select count(*) from public.hm_popup_events e where e.creative_id = c.id and e.event = 'click' and e.created_at > now() - interval '30 days'),
            'cv', (select count(distinct e.session_id) from public.hm_popup_events e
                   join public.hm_conversions cv on cv.site_id = e.site_id and cv.session_id = e.session_id and cv.created_at >= e.created_at
                   where e.creative_id = c.id and e.event = 'click' and e.created_at > now() - interval '30 days')
          ) order by c.created_at)
          from public.hm_creatives c where c.popup_id = p.id and c.enabled), '[]')
      ) order by p.priority desc, p.created_at)
      from public.hm_popups p where p.site_id = s.id and p.status = 'active'), '[]'),
    'page', (
      select jsonb_build_object(
        'n', count(*),
        'med_ms', percentile_cont(0.5) within group (order by x.duration_ms),
        'med_scroll', percentile_cont(0.5) within group (order by x.pct))
      from (
        select pv.duration_ms, least(1.0, pv.max_scroll::float / nullif(pv.doc_h, 0)) as pct
        from public.hm_pageviews pv
        where pv.site_id = s.id and pv.url = p_url and pv.created_at > now() - interval '14 days' and pv.duration_ms > 0
        order by pv.created_at desc limit 2000
      ) x)
  ) into res;
  return res;
end $$;

-- ============ 計測タグ：データ送信 ============
create or replace function public.hm_track(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.hm_sites;
  v jsonb;
  v_pv jsonb;
  existing_site uuid;
  mon date := date_trunc('month', now())::date;
  used int;
  v_clicks jsonb;
  v_att int[];
begin
  if pg_column_size(p) > 300000 then raise exception 'payload too large'; end if;
  s := public.hm_site_for_key(p ->> 'k');
  v_pv := p -> 'pv';

  if v_pv is not null and v_pv ->> 'id' is not null then
    v_clicks := coalesce(v_pv -> 'clicks', '[]'::jsonb);
    if jsonb_typeof(v_clicks) <> 'array' then v_clicks := '[]'; end if;
    if jsonb_array_length(v_clicks) > 300 then
      select jsonb_agg(x) into v_clicks from (select x from jsonb_array_elements(v_clicks) x limit 300) q;
    end if;
    select coalesce(array_agg(least(greatest(coalesce(x::int, 0), 0), 3600000) order by i), '{}')
      into v_att
      from jsonb_array_elements_text(coalesce(v_pv -> 'att', '[]'::jsonb)) with ordinality as a(x, i)
      where i <= 100;

    select site_id into existing_site from public.hm_pageviews where id = (v_pv ->> 'id')::uuid;
    if existing_site is null then
      select u.pv into used from public.hm_site_usage u where u.site_id = s.id and u.month = mon;
      if coalesce(used, 0) >= s.pv_limit then
        return jsonb_build_object('ok', false, 'limit', true);
      end if;
      insert into public.hm_pageviews (id, site_id, visitor_id, session_id, url, full_url, title, referrer, source, device, is_new,
        vw, vh, doc_w, doc_h, max_scroll, duration_ms, attention, clicks, snap_hash)
      values ((v_pv ->> 'id')::uuid, s.id, left(v_pv ->> 'v', 64), left(v_pv ->> 's', 64), left(v_pv ->> 'url', 1000), left(v_pv ->> 'full_url', 2000),
        left(v_pv ->> 'title', 300), left(v_pv ->> 'ref', 1000), left(coalesce(v_pv ->> 'src', 'direct'), 200),
        case when v_pv ->> 'dev' in ('pc','sp','tab') then v_pv ->> 'dev' else 'pc' end,
        coalesce((v_pv ->> 'new')::boolean, true),
        (v_pv ->> 'vw')::int, (v_pv ->> 'vh')::int, (v_pv ->> 'dw')::int, (v_pv ->> 'dh')::int,
        coalesce((v_pv ->> 'ms')::int, 0), least(coalesce((v_pv ->> 'dur')::int, 0), 86400000), v_att, v_clicks, left(v_pv ->> 'hash', 64))
      on conflict (id) do nothing;
      insert into public.hm_site_usage (site_id, month, pv) values (s.id, mon, 1)
      on conflict (site_id, month) do update set pv = public.hm_site_usage.pv + 1;
    elsif existing_site = s.id then
      update public.hm_pageviews set
        max_scroll = greatest(max_scroll, coalesce((v_pv ->> 'ms')::int, 0)),
        duration_ms = greatest(duration_ms, least(coalesce((v_pv ->> 'dur')::int, 0), 86400000)),
        attention = case when array_length(v_att, 1) > 0 then v_att else hm_pageviews.attention end,
        clicks = case when jsonb_array_length(v_clicks) >= jsonb_array_length(hm_pageviews.clicks) then v_clicks else hm_pageviews.clicks end,
        doc_w = coalesce((v_pv ->> 'dw')::int, doc_w),
        doc_h = greatest(coalesce((v_pv ->> 'dh')::int, 0), coalesce(doc_h, 0)),
        snap_hash = coalesce(left(v_pv ->> 'hash', 64), snap_hash),
        updated_at = now()
      where id = (v_pv ->> 'id')::uuid;
    end if;
  end if;

  -- CV
  for v in select * from jsonb_array_elements(coalesce(p -> 'cv', '[]'::jsonb)) loop
    insert into public.hm_conversions (site_id, cv_tag_id, session_id, visitor_id, pv_id, url)
    select s.id, t.id, left(p #>> '{pv,s}', 64), left(p #>> '{pv,v}', 64), nullif(p #>> '{pv,id}', '')::uuid, left(v ->> 'url', 1000)
    from public.hm_cv_tags t where t.id = (v ->> 'tag')::uuid and t.site_id = s.id
    on conflict (cv_tag_id, session_id) do nothing;
  end loop;

  -- ポップアップイベント
  for v in select * from jsonb_array_elements(coalesce(p -> 'ev', '[]'::jsonb)) loop
    insert into public.hm_popup_events (id, site_id, popup_id, creative_id, session_id, visitor_id, pv_id, event, step, answer, trigger, device)
    select (v ->> 'id')::uuid, s.id, pp.id, nullif(v ->> 'cr', '')::uuid, left(p #>> '{pv,s}', 64), left(p #>> '{pv,v}', 64),
      nullif(p #>> '{pv,id}', '')::uuid, v ->> 'ev', left(v ->> 'step', 100), left(v ->> 'ans', 300), left(v ->> 'tr', 50), left(p #>> '{pv,dev}', 10)
    from public.hm_popups pp where pp.id = (v ->> 'popup')::uuid and pp.site_id = s.id
    on conflict (id) do nothing;
  end loop;

  -- 保存期間を過ぎたデータの削除（負荷分散のため確率的に実行）
  if random() < 0.003 then
    delete from public.hm_pageviews where site_id = s.id and created_at < now() - make_interval(days => s.retention_days);
    delete from public.hm_popup_events where site_id = s.id and created_at < now() - make_interval(days => s.retention_days);
    delete from public.hm_conversions where site_id = s.id and created_at < now() - make_interval(days => s.retention_days);
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- ============ 計測タグ：デザイン保存 ============
create or replace function public.hm_snapshot_needed(p_key text, p_url text, p_device text, p_hash text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s public.hm_sites;
begin
  s := public.hm_site_for_key(p_key);
  return not exists (select 1 from public.hm_snapshots where site_id = s.id and url = p_url and device = p_device and hash = p_hash);
end $$;

create or replace function public.hm_snapshot_put(p_key text, p_url text, p_device text, p_hash text, p_html text, p_w int, p_h int)
returns boolean
language plpgsql security definer set search_path = public as $$
declare s public.hm_sites;
begin
  s := public.hm_site_for_key(p_key);
  if length(p_html) > 3000000 then return false; end if;
  insert into public.hm_snapshots (site_id, url, device, hash, html, doc_w, doc_h)
  values (s.id, left(p_url, 1000), p_device, left(p_hash, 64), p_html, p_w, p_h)
  on conflict (site_id, url, device, hash) do nothing;
  delete from public.hm_snapshots where id in (
    select id from public.hm_snapshots
    where site_id = s.id and url = p_url and device = p_device
    order by created_at desc offset greatest(s.snapshot_versions, 1));
  return true;
end $$;

-- ============ 分析：ヒートマップ本体 ============
-- p_seg: {"cv":"all|cv|noncv","cv_tag":uuid,"source":text,"visitor":"all|new|return"}
create or replace function public.hm_heatmap_core(p_site uuid, p_url text, p_device text, p_from timestamptz, p_to timestamptz, p_seg jsonb, p_hash text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  with cvs as (
    select distinct c.session_id from public.hm_conversions c
    where c.site_id = p_site and c.created_at >= p_from and c.created_at < p_to + interval '1 day'
      and (p_seg ->> 'cv_tag' is null or c.cv_tag_id = (p_seg ->> 'cv_tag')::uuid)
  ),
  pv as (
    select v.* from public.hm_pageviews v
    where v.site_id = p_site and v.url = p_url and v.device = p_device
      and v.created_at >= p_from and v.created_at < p_to
      and (p_hash is null or v.snap_hash = p_hash)
      and (coalesce(p_seg ->> 'visitor', 'all') = 'all'
           or (p_seg ->> 'visitor' = 'new' and v.is_new) or (p_seg ->> 'visitor' = 'return' and not v.is_new))
      and (coalesce(p_seg ->> 'source', '') = '' or v.source = p_seg ->> 'source')
      and (coalesce(p_seg ->> 'cv', 'all') = 'all'
           or (p_seg ->> 'cv' = 'cv' and v.session_id in (select session_id from cvs))
           or (p_seg ->> 'cv' = 'noncv' and v.session_id not in (select session_id from cvs)))
  ),
  pct as (
    select least(1.0, greatest(0.0, max_scroll::float / nullif(doc_h, 0))) as r from pv where doc_h > 0
  ),
  scroll as (
    select coalesce(jsonb_agg(cnt order by i), '[]') as a from (
      select g.i, (select count(*) from pct where pct.r * 100 >= g.i) as cnt
      from generate_series(0, 99) g(i)) q
  ),
  att as (
    select coalesce(jsonb_agg(total order by i), '[]') as a from (
      select g.i, coalesce((select sum(pv.attention[g.i + 1]) from pv), 0) as total
      from generate_series(0, 99) g(i)) q
  ),
  cl as (
    select c from pv, jsonb_array_elements(pv.clicks) c
    order by pv.created_at desc limit 30000
  ),
  rnk as (
    select coalesce(jsonb_agg(r order by (r ->> 'n')::int desc), '[]') as a from (
      select jsonb_build_object('s', c ->> 's', 'tx', max(c ->> 'tx'), 'h', max(c ->> 'h'), 'tag', max(c ->> 't'), 'n', count(*)) as r
      from cl group by c ->> 's' order by count(*) desc limit 200) q
  )
  select jsonb_build_object(
    'n', (select count(*) from pv),
    'sessions', (select count(distinct session_id) from pv),
    'cv_sessions', (select count(distinct session_id) from pv where session_id in (select session_id from cvs)),
    'avg_doc_h', (select avg(doc_h) from pv),
    'avg_doc_w', (select avg(doc_w) from pv),
    'med_ms', (select percentile_cont(0.5) within group (order by duration_ms) from pv),
    'scroll', (select a from scroll),
    'attention', (select a from att),
    'clicks', coalesce((select jsonb_agg(c) from cl), '[]'),
    'ranking', (select a from rnk),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'n', n) order by n desc)
                         from (select source, count(*) n from pv group by source order by count(*) desc limit 30) q), '[]')
  ) into res;
  return res;
end $$;

create or replace function public.hm_heatmap(p_site uuid, p_url text, p_device text, p_from timestamptz, p_to timestamptz, p_seg jsonb default '{}', p_hash text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.hm_require_member();
  return public.hm_heatmap_core(p_site, p_url, p_device, p_from, p_to, coalesce(p_seg, '{}'), p_hash);
end $$;

-- ============ 外部共有（ログイン不要） ============
create or replace function public.hm_shared(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  sh public.hm_shares;
  cfg jsonb;
  snap jsonb;
begin
  select * into sh from public.hm_shares where token = p_token and (expires_at is null or expires_at > now());
  if not found then raise exception 'share not found'; end if;
  cfg := sh.config;
  select jsonb_build_object('html', sn.html, 'doc_w', sn.doc_w, 'doc_h', sn.doc_h, 'hash', sn.hash, 'created_at', sn.created_at)
    into snap
    from public.hm_snapshots sn
    where sn.site_id = sh.site_id and sn.url = cfg ->> 'url' and sn.device = cfg ->> 'device'
      and (cfg ->> 'hash' is null or sn.hash = cfg ->> 'hash')
    order by sn.created_at desc limit 1;
  return jsonb_build_object(
    'config', cfg,
    'site', (select name from public.hm_sites where id = sh.site_id),
    'snapshot', snap,
    'data', public.hm_heatmap_core(sh.site_id, cfg ->> 'url', cfg ->> 'device', (cfg ->> 'from')::timestamptz, (cfg ->> 'to')::timestamptz,
                                   coalesce(cfg -> 'seg', '{}'), cfg ->> 'hash'));
end $$;

-- ============ 分析：ページ一覧・日次 ============
create or replace function public.hm_pages(p_site uuid, p_from timestamptz, p_to timestamptz, p_device text default null)
returns table (url text, title text, pv bigint, sessions bigint, avg_ms numeric, avg_reach numeric, cv_sessions bigint, devices text[])
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.hm_require_member();
  return query
  with cvs as (
    select distinct c.session_id from public.hm_conversions c
    where c.site_id = p_site and c.created_at >= p_from and c.created_at < p_to + interval '1 day'
  )
  select v.url, max(v.title), count(*), count(distinct v.session_id),
    round(avg(v.duration_ms)::numeric, 0),
    round(avg(least(1.0, v.max_scroll::float / nullif(v.doc_h, 0)))::numeric, 3),
    count(distinct v.session_id) filter (where v.session_id in (select session_id from cvs)),
    array_agg(distinct v.device)
  from public.hm_pageviews v
  where v.site_id = p_site and v.created_at >= p_from and v.created_at < p_to
    and (p_device is null or v.device = p_device)
  group by v.url
  order by count(*) desc
  limit 500;
end $$;

create or replace function public.hm_daily(p_site uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, pv bigint, sessions bigint, visitors bigint, cv bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.hm_require_member();
  return query
  select d::date,
    (select count(*) from public.hm_pageviews v where v.site_id = p_site and (v.created_at at time zone 'Asia/Tokyo')::date = d::date),
    (select count(distinct session_id) from public.hm_pageviews v where v.site_id = p_site and (v.created_at at time zone 'Asia/Tokyo')::date = d::date),
    (select count(distinct visitor_id) from public.hm_pageviews v where v.site_id = p_site and (v.created_at at time zone 'Asia/Tokyo')::date = d::date),
    (select count(*) from public.hm_conversions c where c.site_id = p_site and (c.created_at at time zone 'Asia/Tokyo')::date = d::date)
  from generate_series((p_from at time zone 'Asia/Tokyo')::date, ((p_to - interval '1 second') at time zone 'Asia/Tokyo')::date, interval '1 day') d
  order by 1;
end $$;

-- ============ ポップアップレポート ============
create or replace function public.hm_popup_report(p_site uuid, p_from timestamptz, p_to timestamptz)
returns table (popup_id uuid, creative_id uuid, views bigint, clicks bigint, closes bigint, cv_sessions bigint, view_sessions bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.hm_require_member();
  return query
  select e.popup_id, e.creative_id,
    count(*) filter (where e.event = 'view'),
    count(*) filter (where e.event = 'click'),
    count(*) filter (where e.event = 'close'),
    (select count(distinct e2.session_id) from public.hm_popup_events e2
       join public.hm_conversions cv on cv.site_id = e2.site_id and cv.session_id = e2.session_id and cv.created_at >= e2.created_at
       where e2.popup_id = e.popup_id and e2.creative_id is not distinct from e.creative_id and e2.event = 'click'
         and e2.created_at >= p_from and e2.created_at < p_to),
    count(distinct e.session_id) filter (where e.event = 'view')
  from public.hm_popup_events e
  where e.site_id = p_site and e.created_at >= p_from and e.created_at < p_to
  group by e.popup_id, e.creative_id;
end $$;

create or replace function public.hm_popup_daily(p_popup uuid, p_from timestamptz, p_to timestamptz)
returns table (day date, views bigint, clicks bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.hm_require_member();
  return query
  select (e.created_at at time zone 'Asia/Tokyo')::date,
    count(*) filter (where e.event = 'view'), count(*) filter (where e.event = 'click')
  from public.hm_popup_events e
  where e.popup_id = p_popup and e.created_at >= p_from and e.created_at < p_to
  group by 1 order by 1;
end $$;

create or replace function public.hm_scenario_report(p_popup uuid, p_from timestamptz, p_to timestamptz)
returns table (event text, step text, answer text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.hm_require_member();
  return query
  select e.event, e.step, e.answer, count(*)
  from public.hm_popup_events e
  where e.popup_id = p_popup and e.event in ('step','answer','result') and e.created_at >= p_from and e.created_at < p_to
  group by 1, 2, 3 order by 1, 2, 4 desc;
end $$;

-- ============ ファネル分析 ============
-- steps: [{"name":"LP","match":"contains","pattern":"/lp"}, ...]
create or replace function public.hm_funnel_report(p_funnel uuid, p_from timestamptz, p_to timestamptz, p_device text default null)
returns table (step int, name text, sessions int)
language plpgsql stable security definer set search_path = public as $$
declare
  f public.hm_funnels;
  st jsonb;
  k int := 0;
  sess text[];
  ts timestamptz[];
begin
  perform public.hm_require_member();
  select * into f from public.hm_funnels where id = p_funnel;
  if not found then raise exception 'funnel not found'; end if;
  for st in select * from jsonb_array_elements(f.steps) loop
    k := k + 1;
    if k = 1 then
      select coalesce(array_agg(q.session_id), '{}'), coalesce(array_agg(q.t), '{}') into sess, ts from (
        select v.session_id, min(v.created_at) t from public.hm_pageviews v
        where v.site_id = f.site_id and v.created_at >= p_from and v.created_at < p_to
          and (p_device is null or v.device = p_device)
          and public.hm_match(st ->> 'match', st ->> 'pattern', v.url)
        group by v.session_id) q;
    else
      select coalesce(array_agg(q.session_id), '{}'), coalesce(array_agg(q.t), '{}') into sess, ts from (
        select v.session_id, min(v.created_at) t
        from public.hm_pageviews v
        join unnest(sess, ts) as prev(sid, pt) on prev.sid = v.session_id
        where v.site_id = f.site_id and v.created_at >= prev.pt and v.created_at < p_to + interval '1 day'
          and public.hm_match(st ->> 'match', st ->> 'pattern', v.url)
        group by v.session_id) q;
    end if;
    step := k; name := st ->> 'name'; sessions := coalesce(array_length(sess, 1), 0);
    return next;
  end loop;
end $$;

-- ============ 権限 ============
revoke all on function public.hm_heatmap_core(uuid, text, text, timestamptz, timestamptz, jsonb, text) from public, anon, authenticated;
revoke all on function public.hm_site_for_key(text) from public, anon, authenticated;
revoke all on function public.hm_require_member() from public, anon;

grant execute on function public.hm_config(text, text) to anon, authenticated;
grant execute on function public.hm_track(jsonb) to anon, authenticated;
grant execute on function public.hm_snapshot_needed(text, text, text, text) to anon, authenticated;
grant execute on function public.hm_snapshot_put(text, text, text, text, text, int, int) to anon, authenticated;
grant execute on function public.hm_shared(text) to anon, authenticated;

revoke all on function public.hm_heatmap(uuid, text, text, timestamptz, timestamptz, jsonb, text) from public, anon;
revoke all on function public.hm_pages(uuid, timestamptz, timestamptz, text) from public, anon;
revoke all on function public.hm_daily(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.hm_popup_report(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.hm_popup_daily(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.hm_scenario_report(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.hm_funnel_report(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.hm_heatmap(uuid, text, text, timestamptz, timestamptz, jsonb, text) to authenticated;
grant execute on function public.hm_pages(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.hm_daily(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.hm_popup_report(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.hm_popup_daily(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.hm_scenario_report(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.hm_funnel_report(uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.hm_is_member() to authenticated;
