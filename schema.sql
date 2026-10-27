-- BARBERÍA: ejecutar en el SQL Editor del MISMO proyecto Supabase de la perfumería.
-- Todas las tablas tienen prefijo barberia_ para no mezclarse con la app de perfumes.

create extension if not exists pgcrypto;

create table if not exists public.barberia_usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text,
  role text not null default 'barbero' check (role in ('admin','barbero','recepcionista')),
  commission_percent numeric(5,2) not null default 50 check (commission_percent >= 0 and commission_percent <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.barberia_servicios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.barberia_config (
  id integer primary key default 1 check (id = 1),
  name text not null default 'BARBERÍA',
  yape_number text,
  yape_name text,
  qr_path text,
  nps_qr_path text,
  updated_at timestamptz not null default now()
);

create table if not exists public.barberia_cortes (
  id uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barberia_usuarios(id),
  service_id uuid not null references public.barberia_servicios(id),
  price numeric(10,2) not null check (price >= 0),
  commission_percent numeric(5,2) not null default 50 check (commission_percent >= 0 and commission_percent <= 100),
  barber_amount numeric(10,2) not null,
  shop_amount numeric(10,2) not null,
  payment_method text not null default 'yape' check (payment_method in ('yape','efectivo','plin','tarjeta')),
  observations text,
  receipt_path text,
  created_at timestamptz not null default now()
);

insert into public.barberia_config (id) values (1) on conflict (id) do nothing;
insert into public.barberia_servicios (name,price) select 'Corte clásico',25 where not exists(select 1 from public.barberia_servicios where name='Corte clásico');

alter table public.barberia_usuarios enable row level security;
alter table public.barberia_servicios enable row level security;
alter table public.barberia_config enable row level security;
alter table public.barberia_cortes enable row level security;

create or replace function public.barberia_my_role() returns text language sql stable security definer set search_path=public as $$
  select role from public.barberia_usuarios where id=auth.uid() and active=true limit 1;
$$;

-- Lectura: cada usuario puede leer su perfil; admin puede administrar todo.
drop policy if exists "barberia usuarios read" on public.barberia_usuarios;
drop policy if exists "barberia usuarios admin insert" on public.barberia_usuarios;
drop policy if exists "barberia usuarios admin update" on public.barberia_usuarios;
drop policy if exists "barberia servicios read" on public.barberia_servicios;
drop policy if exists "barberia servicios admin insert" on public.barberia_servicios;
drop policy if exists "barberia servicios admin update" on public.barberia_servicios;
drop policy if exists "barberia config read" on public.barberia_config;
drop policy if exists "barberia config admin write" on public.barberia_config;
drop policy if exists "barberia cortes read" on public.barberia_cortes;
drop policy if exists "barberia cortes insert" on public.barberia_cortes;

create policy "barberia usuarios read" on public.barberia_usuarios for select to authenticated using (active=true or id=auth.uid() or public.barberia_my_role()='admin');
create policy "barberia usuarios admin insert" on public.barberia_usuarios for insert to authenticated with check (public.barberia_my_role()='admin');
create policy "barberia usuarios admin update" on public.barberia_usuarios for update to authenticated using (public.barberia_my_role()='admin') with check (public.barberia_my_role()='admin');

create policy "barberia servicios read" on public.barberia_servicios for select to authenticated using (true);
create policy "barberia servicios admin insert" on public.barberia_servicios for insert to authenticated with check (public.barberia_my_role()='admin');
create policy "barberia servicios admin update" on public.barberia_servicios for update to authenticated using (public.barberia_my_role()='admin') with check (public.barberia_my_role()='admin');

create policy "barberia config read" on public.barberia_config for select to authenticated using (true);
create policy "barberia config admin write" on public.barberia_config for all to authenticated using (public.barberia_my_role()='admin') with check (public.barberia_my_role()='admin');

create policy "barberia cortes read" on public.barberia_cortes for select to authenticated using (barber_id=auth.uid() or public.barberia_my_role() in ('admin','recepcionista'));
create policy "barberia cortes insert" on public.barberia_cortes for insert to authenticated with check (public.barberia_my_role() in ('admin','recepcionista'));

-- El servidor calcula montos y comisión desde los datos vigentes, para que un
-- navegador no pueda alterar precios o registrar cortes en nombre de otro.
create or replace function public.barberia_calcular_corte() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v_price numeric(10,2);
  v_commission numeric(5,2);
  v_service_name text;
begin
  select s.price, u.commission_percent, s.name
    into v_price, v_commission, v_service_name
    from public.barberia_servicios s
    join public.barberia_usuarios u on u.id = new.barber_id
   where s.id = new.service_id and s.active = true and u.active = true and u.role in ('admin','barbero');
  if not found then
    raise exception 'El servicio o el barbero no están activos';
  end if;
  -- Barba y cejas: el 100% del servicio corresponde al barbero.
  if translate(lower(v_service_name), 'áéíóúü', 'aeiouu') ~ '(barba|ceja)' then
    v_commission := 100;
  end if;
  new.price := v_price;
  new.commission_percent := v_commission;
  new.barber_amount := round(v_price * v_commission / 100, 2);
  new.shop_amount := v_price - new.barber_amount;
  return new;
end;
$$;

drop trigger if exists barberia_calcular_corte_trigger on public.barberia_cortes;
create trigger barberia_calcular_corte_trigger
before insert on public.barberia_cortes
for each row execute function public.barberia_calcular_corte();

-- Storage privado para comprobantes y QR.
insert into storage.buckets (id,name,public) values ('barberia-comprobantes','barberia-comprobantes',false) on conflict (id) do nothing;

drop policy if exists "barberia storage read" on storage.objects;
drop policy if exists "barberia storage insert" on storage.objects;
create policy "barberia storage read" on storage.objects for select to authenticated using (bucket_id='barberia-comprobantes' and (owner_id=auth.uid()::text or public.barberia_my_role() in ('admin','recepcionista') or name like 'config/%'));
create policy "barberia storage insert" on storage.objects for insert to authenticated with check (bucket_id='barberia-comprobantes');

-- IMPORTANTE: después de crear tu cuenta de administrador en Supabase Auth,
-- reemplaza UUID_AQUI por su UUID y ejecuta:
-- insert into public.barberia_usuarios(id,name,email,role,commission_percent)
-- values ('UUID_AQUI','Administrador','tu-correo@ejemplo.com','admin',50);
