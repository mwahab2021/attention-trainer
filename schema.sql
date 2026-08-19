-- Run this entire file in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.training_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_number integer not null check (session_number between 1 and 30),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  planned_minutes integer not null check (planned_minutes in (20,25,30)),
  actual_seconds integer not null check (actual_seconds >= 0),
  starting_interval numeric not null check (starting_interval > 0),
  ending_interval numeric not null check (ending_interval > 0),
  median_interval numeric not null check (median_interval > 0),
  success_rate numeric not null check (success_rate between 0 and 1),
  trials jsonb not null default '[]'::jsonb,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(user_id, session_number)
);

create table if not exists public.reading_tests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  checkpoint text not null check (checkpoint in ('Baseline','Week 2','Week 4','Week 6')),
  tested_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  mind_wanders integer not null check (mind_wanders >= 0),
  comprehension integer not null check (comprehension between 0 and 100),
  difficulty text not null check (difficulty in ('easy','moderate','hard')),
  material text not null default '',
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(user_id, checkpoint)
);

alter table public.training_sessions enable row level security;
alter table public.reading_tests enable row level security;

drop policy if exists "Users manage own training sessions" on public.training_sessions;
create policy "Users manage own training sessions" on public.training_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users manage own reading tests" on public.reading_tests;
create policy "Users manage own reading tests" on public.reading_tests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists training_sessions_user_completed_idx on public.training_sessions(user_id, completed_at);
create index if not exists reading_tests_user_tested_idx on public.reading_tests(user_id, tested_at);

-- Optional verification: these should both show rowsecurity = true.
select relname, relrowsecurity from pg_class where relname in ('training_sessions','reading_tests');
