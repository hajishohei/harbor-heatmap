-- HarboR Heatmap (SiteLead同等機能) スキーマ
-- 既存の harbor-tool プロジェクトに hm_ 接頭辞で追加する

create extension if not exists pgcrypto;

-- ============ メンバー判定 ============
create table if not exists public.hm_allowed_emails (
  email text primary key,
  created_at timestamptz not null default now()
);

create or replace function public.hm_is_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (auth.jwt() ->> 'email') ilike '%@harbor-live.com'
    or exists (select 1 from public.hm_allowed_emails e where lower(e.email) = lower(auth.jwt() ->> 'email')),
    false)
$$;

-- ============ サイト ============
create table if not exists public.hm_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  site_key text not null unique default replace(gen_random_uuid()::text, '-', ''),
  domains text[] not null default '{}',
  retention_days int not null default 180,
  pv_limit int not null default 200000,
  snapshot_versions int not null default 5,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create table if not exists public.hm_site_usage (
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  month date not null,
  pv int not null default 0,
  primary key (site_id, month)
);

-- ============ PV（ヒートマップの元データ） ============
create table if not exists public.hm_pageviews (
  id uuid primary key,
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  visitor_id text not null,
  session_id text not null,
  url text not null,
  full_url text,
  title text,
  referrer text,
  source text,
  device text not null,
  is_new boolean not null default true,
  vw int, vh int, doc_w int, doc_h int,
  max_scroll int not null default 0,
  duration_ms int not null default 0,
  attention int[] not null default '{}',
  clicks jsonb not null default '[]',
  snap_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists hm_pv_site_url_time on public.hm_pageviews (site_id, url, created_at);
create index if not exists hm_pv_site_time on public.hm_pageviews (site_id, created_at);
create index if not exists hm_pv_session on public.hm_pageviews (site_id, session_id);

-- ============ デザイン保存（スナップショット） ============
create table if not exists public.hm_snapshots (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  url text not null,
  device text not null,
  hash text not null,
  html text not null,
  doc_w int, doc_h int,
  label text,
  created_at timestamptz not null default now(),
  unique (site_id, url, device, hash)
);

-- ============ CV計測 ============
create table if not exists public.hm_cv_tags (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  name text not null,
  type text not null check (type in ('url','click_url','selector','line','asp')),
  match text not null default 'contains' check (match in ('contains','equals','prefix','regex')),
  pattern text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.hm_conversions (
  id bigserial primary key,
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  cv_tag_id uuid not null references public.hm_cv_tags(id) on delete cascade,
  session_id text not null,
  visitor_id text not null,
  pv_id uuid,
  url text,
  created_at timestamptz not null default now(),
  unique (cv_tag_id, session_id)
);
create index if not exists hm_cv_site_time on public.hm_conversions (site_id, created_at);

-- ============ ポップアップ ============
create table if not exists public.hm_popups (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('modal','bar','corner','scenario')),
  status text not null default 'paused' check (status in ('active','paused')),
  priority int not null default 0,
  triggers jsonb not null default '{}',
  conditions jsonb not null default '{}',
  settings jsonb not null default '{}',
  scenario jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hm_creatives (
  id uuid primary key default gen_random_uuid(),
  popup_id uuid not null references public.hm_popups(id) on delete cascade,
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  name text not null default 'A',
  type text not null default 'image' check (type in ('image','html')),
  image_url text,
  html text,
  link_url text,
  alt text,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.hm_popup_events (
  id uuid primary key,
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  popup_id uuid not null references public.hm_popups(id) on delete cascade,
  creative_id uuid,
  session_id text not null,
  visitor_id text not null,
  pv_id uuid,
  event text not null check (event in ('view','click','close','step','answer','result')),
  step text,
  answer text,
  trigger text,
  device text,
  created_at timestamptz not null default now()
);
create index if not exists hm_pe_popup_time on public.hm_popup_events (popup_id, created_at);
create index if not exists hm_pe_site_session on public.hm_popup_events (site_id, session_id);

-- ============ ファネル ============
create table if not exists public.hm_funnels (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  name text not null,
  steps jsonb not null default '[]',
  created_at timestamptz not null default now()
);

-- ============ 外部共有 ============
create table if not exists public.hm_shares (
  token text primary key default replace(gen_random_uuid()::text, '-', ''),
  site_id uuid not null references public.hm_sites(id) on delete cascade,
  config jsonb not null,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

-- ============ RLS ============
do $$
declare t text;
begin
  foreach t in array array['hm_allowed_emails','hm_sites','hm_site_usage','hm_pageviews','hm_snapshots','hm_cv_tags','hm_conversions','hm_popups','hm_creatives','hm_popup_events','hm_funnels','hm_shares']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists hm_member_all on public.%I', t);
    execute format('create policy hm_member_all on public.%I for all to authenticated using (public.hm_is_member()) with check (public.hm_is_member())', t);
  end loop;
end $$;

-- ============ 画像ストレージ ============
insert into storage.buckets (id, name, public)
values ('hm-creatives', 'hm-creatives', true)
on conflict (id) do nothing;

drop policy if exists hm_creatives_write on storage.objects;
create policy hm_creatives_write on storage.objects for insert to authenticated
  with check (bucket_id = 'hm-creatives' and public.hm_is_member());
drop policy if exists hm_creatives_update on storage.objects;
create policy hm_creatives_update on storage.objects for update to authenticated
  using (bucket_id = 'hm-creatives' and public.hm_is_member());
drop policy if exists hm_creatives_delete on storage.objects;
create policy hm_creatives_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hm-creatives' and public.hm_is_member());
