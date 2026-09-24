-- HeroPath — esquema de base de datos (Postgres / Supabase)
-- El servidor lo aplica solo al arrancar; también puedes pegarlo en el SQL Editor de Supabase.
-- Es idempotente: se puede ejecutar varias veces.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null unique,
  password      text not null,
  xp            integer not null default 0,
  streak        integer not null default 0,
  record_streak integer not null default 0,
  last_active   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists users_xp_idx on users (xp desc);

-- Historial de avances: fases de lección, intentos de examen, cursos/ramas dominados y recursos.
create table if not exists progress (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  type          text not null,
  course_id     text,
  lesson_number integer,
  branch_id     text,
  resource_id   text,
  report        text,
  score         integer,
  total         integer,
  passed        boolean,
  completed_at  timestamptz not null default now()
);
create index if not exists progress_user_idx on progress (user_id);
-- Cada recompensa solo puede registrarse una vez (evita XP duplicada aunque lleguen peticiones simultáneas)
create unique index if not exists progress_step_uniq     on progress (user_id, type, course_id, lesson_number) where type in ('lesson', 'challenge', 'exam');
create unique index if not exists progress_course_uniq   on progress (user_id, course_id)   where type = 'course';
create unique index if not exists progress_branch_uniq   on progress (user_id, branch_id)   where type = 'branch';
create unique index if not exists progress_resource_uniq on progress (user_id, resource_id) where type = 'resource';

create table if not exists missions (
  user_id       uuid not null references users (id) on delete cascade,
  day           text not null,
  missions      jsonb not null,
  bonus_claimed boolean not null default false,
  created_at    timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete cascade,
  text        text not null,
  achievement jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists posts_created_idx on posts (created_at desc);

create table if not exists post_likes (
  post_id uuid not null references posts (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  primary key (post_id, user_id)
);

create table if not exists post_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  text       text not null,
  created_at timestamptz not null default now()
);
create index if not exists post_comments_post_idx on post_comments (post_id);

create table if not exists badges (
  user_id   uuid not null references users (id) on delete cascade,
  badge_id  text not null,
  earned_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- Supabase expone el esquema public por su API REST con la clave anónima.
-- Activamos RLS sin políticas: nadie puede leer ni escribir desde esa API (ni los hashes de contraseñas).
-- El backend se conecta como el rol "postgres", que no está sujeto a RLS.
alter table users         enable row level security;
alter table progress      enable row level security;
alter table missions      enable row level security;
alter table posts         enable row level security;
alter table post_likes    enable row level security;
alter table post_comments enable row level security;
alter table badges        enable row level security;
