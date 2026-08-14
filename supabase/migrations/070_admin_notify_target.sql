-- 070_admin_notify_target.sql
--
-- 관리자에게 **새 제보 푸시**를 보내기 위한 대상 계정 연결.
--
-- 배경: 069 로 제보를 관리자 페이지에서 보게 됐지만, 새 제보가 들어와도 알 방법이 없어
-- 관리자가 /admin 을 주기적으로 열어봐야 했다. 놓치기 쉬운 구조라 푸시를 붙인다.
--
-- 왜 컬럼으로 두는가: 관리자 인증(admin_credentials)은 supabase auth 와 분리돼 있어
-- "이 관리자 = 이 앱 계정"이라는 연결이 어디에도 없었다. Edge Function 이 알림 대상을
-- 찾으려면 이메일을 하드코딩해야 하는데, 그러면 계정이 바뀔 때 조용히 깨진다.
-- 명시적 FK 로 두면 관리자가 늘어도 그대로 동작하고, 연결이 없으면 알림만 생략된다.

alter table public.admin_credentials
  add column if not exists notify_user_id uuid references auth.users(id) on delete set null;

comment on column public.admin_credentials.notify_user_id is
  '새 제보 푸시를 받을 앱 계정. null 이면 이 관리자에게는 푸시를 보내지 않는다.';

-- 현재 유일한 관리자(cksgh0316)를 LEAD 의 gmail 계정에 연결한다.
-- ⚠️ 닉네임이 같은 계정이 여러 개라 **이메일로** 특정한다(nickname 으로 고르면 모호).
update public.admin_credentials ac
   set notify_user_id = u.id
  from auth.users u
 where ac.username = 'cksgh0316'
   and u.email = 'cksgh0316@gmail.com'
   and ac.notify_user_id is null;
