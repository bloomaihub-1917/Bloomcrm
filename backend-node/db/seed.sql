-- 기준정보 시드 데이터 (code.gs의 migrateSectorDomains 이관)
-- 실행: psql "$DATABASE_URL" -f db/seed.sql
-- sectors 테이블에 실제 행 자체가 있어야 3)번 UPDATE가 의미가 있으므로,
-- 데이터 이관 스크립트(scripts/migrate-from-sheets.js) 실행 후에 돌린다.

-- 1) 분야(도메인) 목록 등록 (이미 있으면 건드리지 않음)
INSERT INTO settings (key, value)
VALUES ('domains', '[
  {"id":"bio","name":"BIO"},
  {"id":"it","name":"IT"},
  {"id":"vc","name":"VC"},
  {"id":"ai","name":"AI"},
  {"id":"press","name":"기자/미디어"},
  {"id":"mice","name":"MICE"}
]')
ON CONFLICT (key) DO NOTHING;

-- 2) 알려진 섹터 id에 bio/mice 분야 초기 배정 (기존 domain 값이 있으면 덮어쓰지 않음)
UPDATE sectors SET domain = 'bio'
WHERE domain IS NULL AND id IN (
  'pharma','synthetic_drugs','protein_drug','cell_therapy_products','gene_therapy_drugs',
  'therapeutic_antibody','vaccine','blood_preparation','others','medical_device',
  'medical_instruments','medical_supplies','dental_materials',
  'reagents_for_in_vitro_diagnosticsivd_rea','others_medical_device','digital_health',
  'telehealthcare','mobile_health','health_analytics','digital_health_system',
  'others_digital_health','investor','incubator_accelerator','vc_corporate_vc',
  'business_development_1','private_investor','others_investor','academic_non_profit',
  'non_profit_organizat','hospital','academic_university','industry_association',
  'professional_services_and_consulting','cro','cdmo_cmo','drug_delivery',
  'business_development_2','sales_marketing','press_media',
  'others_professional_services_and_consult','gene_therapy_drugs_2',
  'analytical_services','digital_health_2'
);

UPDATE sectors SET domain = 'mice'
WHERE domain IS NULL AND id IN (
  'mice_event','mice_mice','mice_led','mice_broadcast','mice_video','mice_sound',
  'mice_lighting','mice_rental','mice_console','mice_camera','mice_interpret',
  'mice_staffing','mice_electric','mice_structure','mice_pr','mice_sfx',
  'mice_planning','mice_media','mice_etc'
);
