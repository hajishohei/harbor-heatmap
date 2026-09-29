-- ポップアップのプレビュー用（停止中でも取得できる）
create or replace function public.hm_popup_preview(p_key text, p_popup uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.hm_sites;
begin
  s := public.hm_site_for_key(p_key);
  return (select jsonb_build_object(
    'id', p.id, 'kind', p.kind, 'priority', p.priority,
    'triggers', p.triggers, 'conditions', p.conditions, 'settings', p.settings, 'scenario', p.scenario,
    'creatives', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'type', c.type, 'image_url', c.image_url, 'html', c.html, 'link_url', c.link_url, 'alt', c.alt) order by c.created_at)
                           from public.hm_creatives c where c.popup_id = p.id and c.enabled), '[]'))
    from public.hm_popups p where p.id = p_popup and p.site_id = s.id);
end $$;
grant execute on function public.hm_popup_preview(text, uuid) to anon, authenticated;

-- ページ離脱時の sendBeacon（text/plain）受け口
create or replace function public.hm_beacon(text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return public.hm_track($1::jsonb);
end $$;
grant execute on function public.hm_beacon(text) to anon, authenticated;
