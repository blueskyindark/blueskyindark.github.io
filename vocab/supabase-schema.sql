-- Optional dedicated Supabase schema for the vocabulary sync page.
-- Run this once in the Supabase SQL Editor if you want the vocab page to use
-- vocab_load_progress/vocab_save_progress instead of the existing generic
-- pull_progress/push_progress sync functions.

create table if not exists public.vocab_progress_sync (
  code_hash text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.vocab_progress_sync enable row level security;
revoke all on table public.vocab_progress_sync from anon, authenticated;

create or replace function public.vocab_load_progress(p_code_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_code_hash is null or length(p_code_hash) < 32 then
    raise exception 'Invalid sync code hash';
  end if;

  select jsonb_build_object('payload', payload, 'updated_at', updated_at)
    into result
  from public.vocab_progress_sync
  where code_hash = p_code_hash;

  return coalesce(result, jsonb_build_object('payload', null, 'updated_at', null));
end;
$$;

create or replace function public.vocab_save_progress(p_code_hash text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_code_hash is null or length(p_code_hash) < 32 then
    raise exception 'Invalid sync code hash';
  end if;

  insert into public.vocab_progress_sync (code_hash, payload, updated_at)
  values (p_code_hash, coalesce(p_payload, '{}'::jsonb), now())
  on conflict (code_hash) do update
    set payload = excluded.payload,
        updated_at = now()
  returning jsonb_build_object('payload', payload, 'updated_at', updated_at)
    into result;

  return result;
end;
$$;

grant execute on function public.vocab_load_progress(text) to anon, authenticated;
grant execute on function public.vocab_save_progress(text, jsonb) to anon, authenticated;
