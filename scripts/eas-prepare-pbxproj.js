#!/usr/bin/env node
/**
 * eas-prepare-pbxproj.js
 *
 * Run as `eas-build-pre-install` before EAS Build's INSTALL_PODS phase.
 *
 * Why this exists: Xcode 16's `PBXFileSystemSynchronizedRootGroup` (used
 * automatically when adding a new target via the Xcode UI) bumps
 * project.pbxproj's `objectVersion` to 70. The CocoaPods bundled with
 * EAS's worker image is too old to parse v70 — it bails with
 * "Unable to find compatibility version string for object version `70`".
 *
 * Pinning xcodeproj/cocoapods via Gemfile didn't help — EAS calls the
 * system pod, not `bundle exec pod`. So we patch the pbxproj at build
 * time:
 *
 *   1. Downgrade `objectVersion = 70;` → `objectVersion = 56;`
 *      (Xcode 14 compat — what every other RN project uses).
 *   2. Strip the PBXFileSystemSynchronizedRootGroup section entirely.
 *      Replace each child reference inside the project with a normal
 *      PBXGroup that lists every file under `ios/SyncLinkWidget/`
 *      explicitly. This is what Xcode used to generate before 16.0.
 *
 * The patched pbxproj is *not* committed — only the build server sees it.
 * Locally we keep the Xcode-16 native form so the IDE keeps working.
 *
 * Sprint 19 TASK-1900.
 */

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PBXPROJ = path.join(__dirname, '..', 'ios', 'SyncLink.xcodeproj', 'project.pbxproj');

if (!fs.existsSync(PBXPROJ)) {
  // Pre-install runs early; ios/ might not yet be unpacked. Bail quietly.
  console.log('[prepare-pbxproj] ios/ pbxproj not found, skipping');
  process.exit(0);
}

let text = fs.readFileSync(PBXPROJ, 'utf8');

// 1. Downgrade objectVersion ----------------------------------------------
const beforeVer = text;
text = text.replace(/objectVersion = 70;/g, 'objectVersion = 56;');
if (text === beforeVer) {
  console.log('[prepare-pbxproj] objectVersion already <= 56 — nothing to do');
} else {
  console.log('[prepare-pbxproj] downgraded objectVersion 70 → 56');
}

// 2. Convert PBXFileSystemSynchronizedRootGroup → PBXGroup ----------------
//
// The synchronized form looks like (single line wrapped for readability):
//   AD0936FA2F9CD6D4004B697B /* SyncLinkWidget */ = {
//     isa = PBXFileSystemSynchronizedRootGroup;
//     explicitFileTypes = {};
//     explicitFolders = ();
//     path = SyncLinkWidget;
//     sourceTree = "<group>";
//   };
//
// We rewrite every such object as a PBXGroup whose `children` enumerates
// the actual files in that on-disk directory, generating a stable 24-hex
// id for each PBXFileReference. Synchronized groups can only point at a
// directory under the project root, so we resolve `path` accordingly.

const SYNCHRO_RX =
  /([0-9A-F]{24}) \/\* (\w+) \*\/ = \{\s*isa = PBXFileSystemSynchronizedRootGroup;[^}]*?path = (\w+);[^}]*?\};/g;

const fileReferences = [];   // appended later under PBXFileReference section
let convertedCount = 0;

text = text.replace(SYNCHRO_RX, (_match, groupId, groupName, dirPath) => {
  const dirAbs = path.join(__dirname, '..', 'ios', dirPath);
  if (!fs.existsSync(dirAbs)) {
    console.warn(`[prepare-pbxproj] dir missing: ios/${dirPath} — leaving group untouched`);
    return _match;
  }

  // Collect every file under the directory (one level deep — same as Xcode
  // synchronized behaviour for a target group).
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  const childIds = [];

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const id = stableId(`${dirPath}/${ent.name}`);
    childIds.push({ id, name: ent.name, isDir: ent.isDirectory() });

    if (ent.isDirectory()) {
      // For nested dirs (e.g. Assets.xcassets) we add as a folder reference.
      fileReferences.push(
        `\t\t${id} /* ${ent.name} */ = {isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = ${ent.name}; sourceTree = "<group>"; };`,
      );
    } else {
      const fileType = guessFileType(ent.name);
      fileReferences.push(
        `\t\t${id} /* ${ent.name} */ = {isa = PBXFileReference; lastKnownFileType = ${fileType}; path = ${ent.name}; sourceTree = "<group>"; };`,
      );
    }
  }

  convertedCount++;
  const childrenLines = childIds.map((c) => `\t\t\t\t${c.id} /* ${c.name} */,`).join('\n');
  return [
    `${groupId} /* ${groupName} */ = {`,
    `\t\t\tisa = PBXGroup;`,
    `\t\t\tchildren = (`,
    childrenLines,
    `\t\t\t);`,
    `\t\t\tpath = ${dirPath};`,
    `\t\t\tsourceTree = "<group>";`,
    `\t\t};`,
  ].join('\n');
});

// Inject any new PBXFileReference rows into the existing section so the
// IDs we just emitted resolve. We append right before the section's End
// marker so the rest of the file stays intact.
if (fileReferences.length > 0) {
  text = text.replace(
    /(\/\* End PBXFileReference section \*\/)/,
    `${fileReferences.join('\n')}\n$1`,
  );
}

// Remove any orphan "PBXFileSystemSynchronizedRootGroup" begin/end markers
// that are now empty after conversion.
text = text.replace(
  /\/\* Begin PBXFileSystemSynchronizedRootGroup section \*\/\s*\/\* End PBXFileSystemSynchronizedRootGroup section \*\//g,
  '',
);

fs.writeFileSync(PBXPROJ, text, 'utf8');
console.log(
  `[prepare-pbxproj] converted ${convertedCount} synchronized group(s); wrote ${PBXPROJ}`,
);

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Stable 24-char hex id derived from a path so re-running the script
 * yields the same ids — important so build phases that reference these
 * children keep matching across invocations.
 */
function stableId(seed) {
  return crypto.createHash('md5').update('synclink:' + seed).digest('hex').toUpperCase().slice(0, 24);
}

/** Map a filename extension to the corresponding pbxproj `lastKnownFileType`. */
function guessFileType(name) {
  if (name.endsWith('.swift'))         return 'sourcecode.swift';
  if (name.endsWith('.m'))             return 'sourcecode.c.objc';
  if (name.endsWith('.mm'))            return 'sourcecode.cpp.objcpp';
  if (name.endsWith('.h'))             return 'sourcecode.c.h';
  if (name.endsWith('.plist'))         return 'text.plist.xml';
  if (name.endsWith('.entitlements'))  return 'text.plist.entitlements';
  if (name.endsWith('.json'))          return 'text.json';
  if (name.endsWith('.png'))           return 'image.png';
  if (name.endsWith('.xcassets'))      return 'folder.assetcatalog';
  return 'file';
}
