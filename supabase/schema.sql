create table if not exists price_cache (
  id uuid primary key default gen_random_uuid(),
  product_slug text not null unique,
  display_name text not null,
  results jsonb not null,
  cached_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists idx_price_cache_slug on price_cache(product_slug);
create index if not exists idx_price_cache_expires on price_cache(expires_at);

create table if not exists search_log (
  id uuid primary key default gen_random_uuid(),
  raw_query text not null,
  resolved_slug text,
  cache_hit boolean not null,
  created_at timestamptz not null default now()
);

-- Tabela de imagens permanentes, desacoplada do price_cache
create table if not exists perfume_imagens (
  id uuid primary key default gen_random_uuid(),
  nome_normalizado text not null unique,
  nome_produto_neeche text,
  storage_path text,
  fonte text not null default 'neeche',
  confianca_match numeric,
  status text not null default 'pendente',
  atualizado_em timestamptz not null default now(),
  criado_em timestamptz not null default now()
);

create index if not exists idx_perfume_imagens_status on perfume_imagens(status);
create index if not exists idx_perfume_imagens_nome on perfume_imagens(nome_normalizado);

-- Bucket publico para leitura (criar manualmente no painel Supabase ou via SQL abaixo)
-- insert into storage.buckets (id, name, public)
-- values ('perfume-images', 'perfume-images', true)
-- on conflict (id) do nothing;

-- Alertas de preco (notificacao por email quando preco cai)
create table if not exists price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  product_slug text not null,
  display_name text not null,
  baseline_price_cents integer,
  last_notified_price_cents integer,
  last_alerted_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(user_email, product_slug)
);

create index if not exists idx_price_alerts_email on price_alerts(user_email);
create index if not exists idx_price_alerts_enabled on price_alerts(enabled);