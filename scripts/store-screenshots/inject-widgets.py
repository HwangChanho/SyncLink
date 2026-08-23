#!/usr/bin/env python3
"""IconState.plist 에 위젯 배치를 주입한다.

시뮬레이터에는 홈화면에 위젯을 얹는 CLI 가 없다. SpringBoard 가 배치를 이 plist 로
들고 있으므로, 시뮬을 끈 상태에서 항목을 써 넣고 부팅하면 배치된 상태로 뜬다.

사용: inject-widgets.py <UDID> <spec...>
  spec = kind:gridSize   예) SyncLinkCalendarWidget:large
"""
import plistlib, sys, uuid, shutil, os

udid = sys.argv[1]
specs = [s.split(':') for s in sys.argv[2:]]
p = os.path.expanduser(
    f"~/Library/Developer/CoreSimulator/Devices/{udid}/data/Library/SpringBoard/IconState.plist")
shutil.copy(p, p + '.bak')

d = plistlib.load(open(p, 'rb'))

APP = 'io.synclink.app'
APPEX = 'io.synclink.app.SyncLinkWidget'

def widget(kind, size):
    return {
        'widgetIdentifier': kind,
        'elementType': 'widget',
        'containerBundleIdentifier': APP,
        'bundleIdentifier': APPEX,
        'displayIdentifier': str(uuid.uuid4()).upper(),
        'uniqueIdentifier': str(uuid.uuid4()).upper(),
        'allowsExternalSuggestions': False,
        'allowsSuggestions': True,
        'gridSize': size,
        'iconType': 'custom',
    }

# 1페이지를 우리 위젯 전용으로 갈아끼운다(마케팅 컷이라 다른 앱 아이콘은 방해가 된다).
page = [widget(k, s) for k, s in specs]
d['iconLists'] = [page] + list(d.get('iconLists', [])[1:])

plistlib.dump(d, open(p, 'wb'))
print(f"주입 완료: {[f'{k}:{s}' for k, s in specs]} → {p}")
