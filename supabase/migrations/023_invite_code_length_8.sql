-- LEAD 2026-04-28 (Sprint 30): invite_code 8자리 확장.
-- 기존 6자리는 충돌 확률 높음 (300^6 = 7.29e8). 8자리 = 6.56e11.
-- "다른 코드와 절대 겹치면 안 됨" LEAD 명시 요건 대응.
--
-- 안전 변경: 길이 제약 완화 (TEXT 또는 VARCHAR(8) → VARCHAR(16) 으로 여유).
-- 기존 6자리 코드는 그대로 유효, 신규 generate 만 8자리.

DO $$
BEGIN
  -- invite_code 가 VARCHAR 면 길이 확장, TEXT 면 변경 불필요
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'spaces'
      AND column_name = 'invite_code'
      AND data_type = 'character varying'
      AND character_maximum_length < 16
  ) THEN
    ALTER TABLE spaces ALTER COLUMN invite_code TYPE varchar(16);
    RAISE NOTICE 'invite_code length extended to 16';
  ELSE
    RAISE NOTICE 'invite_code length already sufficient (TEXT or >= 16)';
  END IF;

  -- UNIQUE constraint 강화 (이미 있으면 NOOP)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spaces_invite_code_unique'
  ) THEN
    ALTER TABLE spaces ADD CONSTRAINT spaces_invite_code_unique UNIQUE (invite_code);
    RAISE NOTICE 'Added UNIQUE constraint on invite_code';
  END IF;
END $$;
