/**
 * 우리하루 아이콘·로고 에셋 일괄 생성기.
 *
 * 원본은 scripts/brand/icon-svg.mjs 의 SVG 코드 하나다. 여기서 Playwright(chromium)로
 * 렌더해 앱·웹이 쓰는 PNG 를 전부 만든다.
 *
 * 생성물:
 *   images/UriharuLogo.png           1024² 불투명 — iOS 아이콘·위젯·스토어(🔴 iOS 는 투명 금지)
 *   images/UriharuLogo_512.png       512²  불투명
 *   images/UriharuLogo_adaptive.png  1024² 투명 — Android 적응형 전경(마크를 72% 로 축소해
 *                                    안전영역 안에 넣는다. 배경색은 app.json 의 backgroundColor)
 *   images/UriharuLogo_mono.png      1024² 투명 — 밝은 배경·랜딩용 마크
 *   images/SplashScreen.png          1024×1280 — 민트 배경 + 마크 + 워드마크
 *   assets/favicon.png               64²   투명 — 웹 파비콘(🔴 app.json 경로가 그대로라 diff 에 안 잡힌다)
 *   public/get/logo.png              512²  투명 — 랜딩 히어로
 *
 * 사용: node scripts/brand/build-icons.mjs  → 결과 PNG 를 눈으로 확인한 뒤 커밋.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconSvg, ICON_COLORS } from './icon-svg.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${REPO}/`);
const { chromium } = require('playwright');

/** 브랜드 워드마크(스플래시에 쓰인다). 앱 코드의 APP_BRAND 와 같은 값이어야 한다. */
const BRAND_NAME = '우리하루';

/**
 * SVG(1024 좌표계)를 지정 크기 PNG 로 저장한다.
 * @param {import('playwright').Page} page 재사용할 페이지
 * @param {string} svg SVG 문서
 * @param {number} size 출력 한 변(px)
 * @param {string} rel repo 기준 출력 경로
 * @param {boolean} transparent true 면 배경을 투명으로 남긴다(omitBackground)
 */
async function renderSvg(page, svg, size, rel, transparent) {
  await page.setViewportSize({ width: size, height: size });
  // SVG 를 원하는 크기로 늘려 그린다(벡터라 해상도 손실 없음)
  const sized = svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`);
  await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
  await page.screenshot({
    path: path.join(REPO, rel),
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: transparent,
  });
  console.log(`✅ ${rel} (${size}², ${transparent ? '투명' : '불투명'})`);
}

const browser = await chromium.launch();
const page = await browser.newPage();

// 1) 앱 아이콘(불투명) — iOS 는 알파 채널이 있으면 업로드가 거부된다
await renderSvg(page, iconSvg(), 1024, 'images/UriharuLogo.png', false);
await renderSvg(page, iconSvg(), 512, 'images/UriharuLogo_512.png', false);

// 2) Android 적응형 전경 — 런처가 원/물방울 등으로 바깥을 잘라내므로 축소 + 투명
await renderSvg(page, iconSvg({ background: 'none', scale: 0.72 }), 1024, 'images/UriharuLogo_adaptive.png', true);

// 3) 투명 마크 — 웹 로고·파비콘. 64px 에서는 그림자가 번져 지저분해 보여 끈다
await renderSvg(page, iconSvg({ background: 'none' }), 1024, 'images/UriharuLogo_mono.png', true);
await renderSvg(page, iconSvg({ background: 'none' }), 512, 'public/get/logo.png', true);
await renderSvg(page, iconSvg({ background: 'none', shadow: false }), 64, 'assets/favicon.png', true);

// 4) 스플래시 1024×1280 — 기존 규격 유지(app.json splash.image). 배경은 단색 민트
{
  const markUri = `data:image/svg+xml;base64,${Buffer.from(iconSvg({ background: 'none' })).toString('base64')}`;
  await page.setViewportSize({ width: 1024, height: 1280 });
  await page.setContent(`<html><body style="margin:0;width:1024px;height:1280px;background:${ICON_COLORS.bgFlat};
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;
      font-family:'Apple SD Gothic Neo',-apple-system,sans-serif">
    <img src="${markUri}" width="440" height="440"/>
    <div style="font-size:92px;font-weight:800;color:#2F5E50;letter-spacing:-0.02em">${BRAND_NAME}</div>
  </body></html>`);
  // 한글 글꼴이 준비되기 전에 찍으면 네모로 나온다
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(REPO, 'images/SplashScreen.png') });
  console.log('✅ images/SplashScreen.png (1024×1280)');
}

await browser.close();
