-- Room Planner database setup.
-- Run once: Supabase dashboard -> SQL Editor -> New query -> paste all of this -> Run.
-- Every row belongs to one signed-in user (owner_id). Row-level security means
-- a user can only ever see or change their own rows.
-- "deleted_at" marks rows deleted on one computer so other computers learn about it.

create table public.projects (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,                 -- the layout's id
  name       text not null,
  data       jsonb not null,                -- the whole layout
  updated_at timestamptz not null,          -- compared during sync to spot conflicts
  deleted_at timestamptz,
  primary key (owner_id, id)
);

create table public.categories (
  owner_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id         text not null,
  name       text not null,
  color      text not null,
  sort_order integer not null default 0,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  primary key (owner_id, id)
);

create table public.library_items (
  owner_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type           text not null,
  name           text not null,
  default_width  numeric not null,
  default_depth  numeric not null,
  shape          text not null default 'rect' check (shape in ('rect', 'circle')),
  category_id    text not null,
  updated_at     timestamptz not null,
  deleted_at     timestamptz,
  primary key (owner_id, type)
);

alter table public.projects      enable row level security;
alter table public.categories    enable row level security;
alter table public.library_items enable row level security;

create policy "own projects" on public.projects
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "own categories" on public.categories
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "own library items" on public.library_items
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- Signed-out visitors get nothing at all.
revoke all on public.projects      from anon;
revoke all on public.categories    from anon;
revoke all on public.library_items from anon;
