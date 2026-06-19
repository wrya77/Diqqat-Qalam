-- ══════════════════════════════════════════════════════════════════════════════
-- دقة قلم — Supabase Schema (مطابق لقاعدة البيانات الحيّة)
-- شغّل هذا الملف مرة واحدة في Supabase → SQL Editor
-- آمن لإعادة التشغيل (idempotent): يمكنك تشغيله أكثر من مرة دون أخطاء
--
-- الجداول الثلاثة التي يستخدمها التطبيق فعلاً:
--   projects       ← مشاريع المستخدم (CloudStore)
--   user_tools     ← أدوات المستخدم  (CloudStore)
--   subscriptions  ← الاشتراكات       (SubscriptionManager، يكتب عبر service_role)
--
-- ملاحظة عن RLS: user_id في كل الجداول من نوع uuid، لكننا نقارن بـ ::text على
-- الطرفين احتياطاً — يعمل سواء كان العمود uuid أو text ويتجنّب خطأ "text = uuid".
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. مشاريع المستخدمين (RLS — كل مستخدم يرى مشاريعه فقط) ──────────────────
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT        PRIMARY KEY,           -- يولّده الخادم: "<timestamp>_<name>"
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  shapes        JSONB       DEFAULT '[]',
  config        JSONB       DEFAULT '{}',
  gcode         TEXT        DEFAULT '',
  selected_tool JSONB       DEFAULT NULL,          -- كائن الأداة المختارة أو null
  notes         TEXT        DEFAULT '',
  version       TEXT        DEFAULT '1.0',
  saved_at      TIMESTAMPTZ DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- نحذف كل الأسماء المعروفة (الحالي + القديم) لتجنّب سياسات مكرّرة متعارضة
DROP POLICY IF EXISTS "projects_own"                  ON projects;
DROP POLICY IF EXISTS "Users can manage own projects" ON projects;
CREATE POLICY "projects_own" ON projects
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE INDEX IF NOT EXISTS projects_user_idx ON projects(user_id, saved_at DESC);

-- ── 2. أدوات المستخدمين (RLS — كل مستخدم يرى أدواته فقط) ───────────────────
-- التطبيق يخزّن خصائص الأداة في عمود payload (JSONB) عبر CloudStore
CREATE TABLE IF NOT EXISTS user_tools (
  id         TEXT        PRIMARY KEY,              -- يولّده الخادم: "tool_<timestamp>_<rand>"
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  payload    JSONB       DEFAULT '{}',             -- قطر/مادة/تغذية/دوران… إلخ
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_tools_own"             ON user_tools;
DROP POLICY IF EXISTS "Users can manage own tools" ON user_tools;
CREATE POLICY "user_tools_own" ON user_tools
  USING (auth.uid()::text = user_id::text)
  WITH CHECK (auth.uid()::text = user_id::text);

CREATE INDEX IF NOT EXISTS user_tools_user_idx ON user_tools(user_id);

-- ── 3. الاشتراكات (الخادم يكتب عبر service_role، المستخدم يقرأ اشتراكه فقط) ──
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       TEXT        NOT NULL DEFAULT 'free',
  renews_at  TIMESTAMPTZ,
  usage      JSONB       DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- المستخدم يقرأ اشتراكه فقط؛ الكتابة من الخادم عبر service_role (يتجاوز RLS)
DROP POLICY IF EXISTS "sub_read_own"          ON subscriptions;
DROP POLICY IF EXISTS "read own subscription" ON subscriptions;
CREATE POLICY "sub_read_own" ON subscriptions
  FOR SELECT USING (auth.uid()::text = user_id::text);

-- ── 4. الدفعات (الخادم يكتب عبر service_role؛ المستخدم يقرأ دفعاته فقط) ───────
-- حرج على serverless: سجلّ الدفعة يجب أن يكون دائماً ومرئياً لكل نسخ الدالة، وإلا
-- فإن callback المزوّد الذي يصل نسخة مختلفة لا يجد الدفعة فلا تتم الترقية رغم الدفع.
CREATE TABLE IF NOT EXISTS payments (
  id           TEXT        PRIMARY KEY,            -- يولّده الخادم: "pay_<ts>_<rand>"
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan         TEXT        NOT NULL,               -- معرّف الخطة (pro_monthly… إلخ)
  method       TEXT        NOT NULL,               -- fib | card | zaincash
  amount_iqd   INTEGER,
  provider_ref TEXT,                               -- مرجع المزوّد (للاستعلام عن الحالة)
  status       TEXT        NOT NULL DEFAULT 'pending',  -- pending | paid | failed
  created_at   TIMESTAMPTZ DEFAULT now(),
  paid_at      TIMESTAMPTZ
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pay_read_own" ON payments;
CREATE POLICY "pay_read_own" ON payments
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments(provider_ref);
CREATE INDEX IF NOT EXISTS payments_user_idx         ON payments(user_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- (اختياري) تنظيف جداول قديمة غير مستخدمة من إعدادات سابقة
-- جدولا "tools" و"profiles" لا يستخدمهما التطبيق (فارغان). لإزالتهما أزل علامة
-- التعليق عن السطرين التاليين. عمليتان حذفيتان — نفّذهما فقط إن أردت التنظيف.
-- ──────────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS public.tools;
-- DROP TABLE IF EXISTS public.profiles;

-- ══════════════════════════════════════════════════════════════════════════════
-- إعدادات Supabase المطلوبة (في لوحة التحكم):
--
-- Authentication → URL Configuration:
--   Site URL        : https://diqqatqalam.com
--   Redirect URLs   : https://diqqatqalam.com/app
--                     https://diqqatqalam.com/checkout
--                     https://diqqatqalam.com/auth
--
-- Authentication → Providers:
--   Email: مُفعَّل
--   Google OAuth: مُفعَّل (اختياري)
--
-- Authentication → Policies:
--   فعّل "Leaked Password Protection" (يمنع كلمات المرور المسرّبة)
-- ══════════════════════════════════════════════════════════════════════════════
