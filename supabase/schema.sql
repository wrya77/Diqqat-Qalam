-- ══════════════════════════════════════════════════════════════════════════════
-- دقة قلم — Supabase Schema
-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor
-- آمن لإعادة التشغيل (idempotent): يمكنك تشغيله أكثر من مرة دون أخطاء
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. مشاريع المستخدمين (RLS — كل مستخدم يرى مشاريعه فقط) ──────────────────
CREATE TABLE IF NOT EXISTS projects (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  shapes     JSONB       DEFAULT '[]',
  config     JSONB       DEFAULT '{}',
  gcode      TEXT        DEFAULT '',
  selected_tool TEXT     DEFAULT NULL,
  notes      TEXT        DEFAULT '',
  version    TEXT        DEFAULT '1',
  saved_at   TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "projects_own" ON projects;
-- المقارنة بـ ::text على الطرفين تعمل سواء كان user_id من نوع uuid أو text
CREATE POLICY "projects_own" ON projects
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id, saved_at DESC);

-- ── 2. أدوات المستخدمين (RLS — كل مستخدم يرى أدواته فقط) ───────────────────
CREATE TABLE IF NOT EXISTS tools (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  type        TEXT        DEFAULT 'endmill',
  diameter    NUMERIC     DEFAULT 3,
  material    TEXT        DEFAULT 'aluminum',
  max_depth   NUMERIC     DEFAULT 1,
  feed_rate   NUMERIC     DEFAULT 800,
  plunge_rate NUMERIC     DEFAULT 300,
  spindle_rpm INTEGER     DEFAULT 10000,
  notes       TEXT        DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tools_own" ON tools;
CREATE POLICY "tools_own" ON tools
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE INDEX IF NOT EXISTS tools_user_idx ON tools(user_id);

-- ── 3. الاشتراكات (service_role فقط — الخادم يكتب، المستخدم يقرأ اشتراكه) ──
-- user_id من نوع TEXT لأن SubscriptionManager يخزّن معرّف Supabase كنص
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id    TEXT        PRIMARY KEY,
  plan       TEXT        NOT NULL DEFAULT 'free',
  renews_at  TIMESTAMPTZ,
  usage      JSONB       DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_read_own" ON subscriptions;
-- المستخدم يقرأ اشتراكه فقط عبر JWT (::text على الطرفين يتجنّب خطأ text = uuid)
CREATE POLICY "sub_read_own" ON subscriptions
  FOR SELECT USING (auth.uid()::text = user_id::text);

-- الكتابة من الخادم عبر service_role فقط (يتجاوز RLS — لا policy مطلوبة)

-- ══════════════════════════════════════════════════════════════════════════════
-- إعدادات Supabase المطلوبة (في لوحة التحكم):
--
-- Authentication → URL Configuration:
--   Site URL        : https://diqqatqalam.com
--   Redirect URLs   : https://diqqatqalam.com/app
--                     https://diqqatqalam.com/checkout
--
-- Authentication → Providers:
--   Email: مُفعَّل
--   Google OAuth: مُفعَّل (اختياري)
-- ══════════════════════════════════════════════════════════════════════════════
