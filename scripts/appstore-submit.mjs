#!/usr/bin/env node
/**
 * appstore-submit — App Store 버전 생성 → 빌드 연결 → 출시노트 → 심사 제출.
 *
 *   node scripts/appstore-submit.mjs <version> <buildNumber> <notesFile> [--manual-release] [--submit]
 *
 * 인자 없이(=--submit 없이) 실행하면 **dry-run** — 무엇을 할지 보여주기만 한다.
 *
 * 기본값            releaseType=AFTER_APPROVAL (심사 통과 시 자동 출시)
 * `--manual-release` releaseType=MANUAL        (통과 후 appstore-release.mjs 로 수동 출시)
 *
 * 🔑 **기본값이 AFTER_APPROVAL 인 이유**(2026-09-10 LEAD 지시): 이 앱은 1.4.4~1.4.13
 *    열 개 버전이 **전부 AFTER_APPROVAL** 이었다. 즉 자동 출시가 관례인데 종전 기본값은
 *    MANUAL 이라 `--auto-release` 를 빠뜨리면 관례에서 벗어났다. 실제로 1.4.14 를
 *    그렇게 제출했다가 되돌렸다. **기본값은 관례와 같아야 한다** — 자주 쓰는 쪽을
 *    기본으로 두고, 드문 쪽에 플래그를 붙인다.
 *    (`--auto-release` 는 이제 기본값과 같으므로 붙여도 무해하다. 손에 익은 사람을 위해 받아준다.)
 *
 * 이 흐름을 스크래치패드에 두었다가 한 세션에서 두 번 잃었다(asc.mjs 등) → 리포에 둔다.
 *
 * 🔴 ASC JWT: 서명은 raw R||S(`dsaEncoding:'ieee-p1363'`, DER 이면 401), 만료 최대 20분.
 * ⚠️ 앱에 편집 가능한 버전은 하나뿐이다. 이미 심사 대기 중인 버전이 있으면 생성이 실패한다.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_ID = '2GBSCKXQJ4';
const ISSUER = '5f89581a-d0c6-46c2-9461-78d5c08448fa';
const APP_ID = '6763083903';
const KEY_PATH = path.join(REPO, 'credentials/AuthKey_2GBSCKXQJ4.p8');

const b64u = (i) => Buffer.from(i).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = Math.floor(Date.now() / 1000);
const unsigned =
  `${b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }))}.` +
  `${b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }))}`;
const signer = createSign('SHA256');
signer.update(unsigned); signer.end();
const TOKEN = `${unsigned}.${b64u(signer.sign({ key: readFileSync(KEY_PATH, 'utf8'), dsaEncoding: 'ieee-p1363' }))}`;

const api = async (p, opts = {}) => {
  const r = await fetch(`https://api.appstoreconnect.apple.com${p}`, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (j.errors) throw new Error(`${r.status} ${JSON.stringify(j.errors).slice(0, 400)}`);
  return j;
};

const [versionString, buildNumber, notesFile] = process.argv.slice(2);
// 기본은 자동 출시. 수동 출시는 드문 경우라 플래그를 붙인다.
// (`--auto-release` 는 기본값과 동일 — 종전 습관대로 붙여도 동작이 같다.)
const manualRelease = process.argv.includes('--manual-release');
const doSubmit = process.argv.includes('--submit');

if (!versionString || !buildNumber || !notesFile) {
  console.log('usage: appstore-submit.mjs <version> <buildNumber> <notesFile> [--manual-release] [--submit]');
  process.exit(1);
}
const notes = readFileSync(notesFile, 'utf8').trimEnd();
const releaseType = manualRelease ? 'MANUAL' : 'AFTER_APPROVAL';

console.log('제출 계획');
console.log(`  버전     : ${versionString}`);
console.log(`  빌드     : ${buildNumber}`);
console.log(`  출시방식 : ${releaseType}${manualRelease ? ' (통과 후 수동 출시 필요)' : ' (심사 통과 시 자동 출시 — 기본값)'}`);
console.log(`  노트     : ${notes.length}자`);

if (!doSubmit) {
  console.log('\n(dry-run — 실제로 진행하려면 `--submit`)');
  process.exit(0);
}

// 빌드가 VALID 인지 먼저 본다. PROCESSING 상태로 연결하면 심사에 못 올린다.
const builds = await api(`/v1/builds?filter[app]=${APP_ID}&limit=20&sort=-uploadedDate`);
const build = builds.data.find((b) => b.attributes.version === String(buildNumber));
if (!build) throw new Error(`build ${buildNumber} 를 ASC 에서 찾지 못했습니다`);
if (build.attributes.processingState !== 'VALID') {
  throw new Error(`build ${buildNumber} 상태가 ${build.attributes.processingState} — VALID 가 될 때까지 기다리세요`);
}

// 같은 versionString 이 이미 있으면 재사용한다(중복 생성은 409).
const versions = await api(`/v1/apps/${APP_ID}/appStoreVersions?limit=10`);
let version = versions.data.find((v) => v.attributes.versionString === versionString);

if (version) {
  console.log(`\n기존 버전 재사용: ${version.id} (${version.attributes.appStoreState})`);
  // 출시 방식이 다르면 맞춘다.
  if (version.attributes.releaseType !== releaseType) {
    await api(`/v1/appStoreVersions/${version.id}`, {
      method: 'PATCH',
      body: { data: { type: 'appStoreVersions', id: version.id, attributes: { releaseType } } },
    });
    console.log(`  releaseType → ${releaseType}`);
  }
} else {
  /**
   * 🔴 앱에 **편집 가능한 버전은 하나뿐**이다. 이미 하나가 열려 있으면
   * POST /appStoreVersions 가 409 로 거부된다:
   *   "You cannot create a new version of the App in the current state."
   * 이 상황은 흔하다 — 직전 버전을 심사에 올렸다가 취소하면
   * DEVELOPER_REJECTED 로 **열린 채 남기** 때문이다(2026-09-06 실제로 겪음).
   *
   * 그때는 새로 만들 게 아니라 **그 열린 버전의 번호를 바꿔 재사용**한다.
   * 스크린샷·설명 등 메타데이터가 그대로 따라와 오히려 이득이다.
   */
  const EDITABLE = new Set([
    'PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED',
    'METADATA_REJECTED', 'INVALID_BINARY',
  ]);
  const reusable = versions.data.find(
    (v) => EDITABLE.has(v.attributes.appStoreState)
      // 아주 오래된 잔재 버전(1.0 등)까지 끌어다 쓰지 않도록 현재 라이브보다 뒤인 것만.
      && v.attributes.versionString !== '1.0',
  );

  if (reusable) {
    console.log(
      `\n열린 버전 재사용: ${reusable.attributes.versionString} ` +
      `(${reusable.attributes.appStoreState}) → ${versionString}`,
    );
    await api(`/v1/appStoreVersions/${reusable.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'appStoreVersions',
          id: reusable.id,
          attributes: { versionString, releaseType },
        },
      },
    });
    version = reusable;
    console.log(`  버전 번호 변경 완료: ${version.id}`);
  } else {
    const created = await api('/v1/appStoreVersions', {
      method: 'POST',
      body: {
        data: {
          type: 'appStoreVersions',
          attributes: { platform: 'IOS', versionString, releaseType },
          relationships: { app: { data: { type: 'apps', id: APP_ID } } },
        },
      },
    });
    version = created.data;
    console.log(`\n버전 생성: ${version.id}`);
  }
}

await api(`/v1/appStoreVersions/${version.id}/relationships/build`, {
  method: 'PATCH',
  body: { data: { type: 'builds', id: build.id } },
});
console.log(`  빌드 ${buildNumber} 연결`);

const locs = await api(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
const ko = locs.data.find((l) => l.attributes.locale.startsWith('ko')) ?? locs.data[0];
await api(`/v1/appStoreVersionLocalizations/${ko.id}`, {
  method: 'PATCH',
  body: { data: { type: 'appStoreVersionLocalizations', id: ko.id, attributes: { whatsNew: notes } } },
});
console.log(`  출시노트 설정 (${ko.attributes.locale})`);

/**
 * 🔴 promotionalText 자동 승계 — ASC 는 새 버전에 이 필드를 복사하지 않는다.
 *
 * 2026-09-08 까지 **일곱 번** 같은 일을 당했다. 매번 사람이 알아채고 손으로
 * 넣었는데, 알아채지 못하면 그대로 출시돼 스토어 상단 문구가 비어 버린다.
 * 그래서 제출 흐름 안에서 자동으로 채운다.
 *
 * 값은 **하드코딩하지 않고 현재 라이브 버전에서 읽어 온다** — LEAD 가 라이브
 * 버전의 문구를 고치면(그 필드는 심사 없이 즉시 반영된다) 다음 버전이
 * 자동으로 그 최신값을 물려받는다.
 *
 * ⚠️ 새 버전에 이미 값이 있으면 건드리지 않는다 — 사람이 의도적으로 다르게
 *    써 넣었을 수 있다.
 */
try {
  const current = (ko.attributes.promotionalText ?? "").trim();
  if (current.length > 0) {
    console.log(`  promotionalText: 이미 있음(${[...current].length}자) — 건드리지 않음`);
  } else {
    // 라이브(READY_FOR_SALE) 버전의 ko 로컬라이제이션에서 값을 가져온다.
    const live = versions.data.find((v) => v.attributes.appStoreState === "READY_FOR_SALE");
    if (!live) {
      console.log("  promotionalText: 비어 있으나 라이브 버전이 없어 승계 불가 — 수동 확인 필요");
    } else {
      const liveLocs = await api(`/v1/appStoreVersions/${live.id}/appStoreVersionLocalizations`);
      const liveKo = liveLocs.data.find((l) => l.attributes.locale.startsWith("ko")) ?? liveLocs.data[0];
      const inherited = (liveKo?.attributes?.promotionalText ?? "").trim();
      if (inherited.length === 0) {
        console.log("  promotionalText: 라이브 버전에도 비어 있음 — 승계할 값 없음");
      } else {
        await api(`/v1/appStoreVersionLocalizations/${ko.id}`, {
          method: "PATCH",
          body: { data: { type: "appStoreVersionLocalizations", id: ko.id, attributes: { promotionalText: inherited } } },
        });
        // 되읽어 검증 — "요청했다"가 아니라 "실제로 들어갔다"를 확인한다.
        const after = await api(`/v1/appStoreVersionLocalizations/${ko.id}`);
        const saved = (after?.data?.attributes?.promotionalText ?? "").trim();
        console.log(saved === inherited
          ? `  promotionalText: ${live.attributes.versionString} 에서 승계 ✅ (${[...saved].length}자)`
          : "  🔴 promotionalText 승계 실패 — 손으로 확인할 것");
      }
    }
  }
} catch (e) {
  // 승계 실패가 제출 자체를 막지는 않게 한다. 다만 조용히 넘어가지도 않는다.
  console.log(`  🔴 promotionalText 처리 중 오류(제출은 계속): ${e instanceof Error ? e.message : e}`);
}

// 심사 제출 — reviewSubmission 을 열고 이 버전을 항목으로 붙인 뒤 제출한다.
const sub = await api('/v1/reviewSubmissions', {
  method: 'POST',
  body: {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: 'IOS' },
      relationships: { app: { data: { type: 'apps', id: APP_ID } } },
    },
  },
});
await api('/v1/reviewSubmissionItems', {
  method: 'POST',
  body: {
    data: {
      type: 'reviewSubmissionItems',
      relationships: {
        reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.data.id } },
        appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
      },
    },
  },
});
await api(`/v1/reviewSubmissions/${sub.data.id}`, {
  method: 'PATCH',
  body: { data: { type: 'reviewSubmissions', id: sub.data.id, attributes: { submitted: true } } },
});

const after = await api(`/v1/appStoreVersions/${version.id}`);
console.log(`\n제출 완료 → 상태: ${after.data.attributes.appStoreState}`);
console.log(`  출시방식: ${after.data.attributes.releaseType}`);
