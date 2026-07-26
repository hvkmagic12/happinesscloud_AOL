-- Happiness Cloud — messages table + RLS
-- Run this in the Supabase SQL editor for your project.

create extension if not exists pgcrypto;

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) > 0 and char_length(text) <= 200),
  name text check (name is null or char_length(name) <= 80),
  state text check (state is null or char_length(state) <= 80),
  created_at timestamptz not null default now(),
  hue_offset float not null default random() * 30 - 15,
  approved boolean not null default true
);

alter table messages enable row level security;

-- Anyone can submit a message, as long as it passes the same length/content
-- check enforced by the column constraint above.
create policy "public can insert messages"
  on messages for insert
  to anon
  with check (char_length(text) > 0 and char_length(text) <= 200);

-- Anyone can read approved messages (the cloud view only ever needs these).
create policy "public can read approved messages"
  on messages for select
  to anon
  using (approved = true);

-- Realtime: allow the client to subscribe to new inserts on this table.
alter publication supabase_realtime add table messages;

-- Migration: run this block instead if the `messages` table already exists
-- in your project (e.g. it was created before the name/state columns were
-- added) — `create table if not exists` above won't retroactively add
-- columns to an existing table.
-- alter table messages add column if not exists name text check (name is null or char_length(name) <= 80);
-- alter table messages add column if not exists state text check (state is null or char_length(state) <= 80);
