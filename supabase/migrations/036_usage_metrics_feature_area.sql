-- v1.2 Phase 5 — usage_metrics 에 feature_area 컬럼 추가.
--
-- 비용 추적을 voice / chat / context_card / auto_review / other 단위로
-- 끊어 일별 admin dashboard 에서 카테고리별 비용을 볼 수 있게 한다.
-- 기존 function_name 컬럼은 그대로 유지 (구체적 추적용), feature_area 는
-- 상위 카테고리 (집계용).

alter table public.usage_metrics
  add column if not exists feature_area text;

-- 기존 row 마이그레이션: function_name 매핑.
update public.usage_metrics
  set feature_area = case
    when function_name = 'disambiguate-voice' then 'voice'
    when function_name = 'assistant-chat'    then 'chat'
    when function_name = 'suggest-slot'      then 'context_card'
    when function_name in ('recommend-free-time', 'suggest-date') then 'context_card'
    when function_name = 'weekly-review'     then 'auto_review'
    when function_name = 'parse-event' or function_name = 'parse-event-vision' then 'voice'
    else 'other'
  end
  where feature_area is null;

create index if not exists usage_metrics_feature_area_idx
  on public.usage_metrics (feature_area, created_at desc);
