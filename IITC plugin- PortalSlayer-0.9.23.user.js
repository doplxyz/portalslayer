// ==UserScript==
// @author         DOPPELGENGER,GEMINI3PRO,JULES
// @name           IITC plugin: PortalSlayer
// @category       d.org.addon
// @version        0.9.23
// @description    [0.9.23] Faction-based Portal Counter
// @id             portal-slayer
// @namespace      https://example.com/
// @include        https://intel.ingress.com/*
// @include        https://intel-x.ingress.com/*
// @grant          none
// ==/UserScript==

/*
  [ Credits / Acknowledgments ]
  This plugin incorporates logic and design concepts from the following IITC plugins:
  1. IITC plugin: Portal Names
  2. IITC plugin: Portal Audit / Portal Audit Mini
  3. IITC: FlipChecker
  All credit for the original logic goes to their respective authors.
*/

function wrapper(plugin_info) {
  'use strict';

  // --- USER CONFIGURABLE SETTINGS ---
  const UI_ZOOM_BOTTOM = '40px'; // Position of Zoom Display
  const UI_COUNTER_BOTTOM = '60px'; // Position of Portal Counter (Above Zoom)
  const COUNTER_UPDATE_INTERVAL = 3000; // ms

  const EXPERT_PRESETS = {
     'lvl0': { name: 'Lv0-SAFEMODE',  offset: 0, parallel: 2, delay: 1000 },
     'lvl1': { name: 'LV1-DEFAULT',   offset: 0, parallel: 5, delay: 0   },
     'lvl2': { name: 'LV2-SLAYER-MINI',  offset: 2, parallel: 2, delay: 1000 },
     'lvl3': { name: 'LV3-SLAYER-HIGH',  offset: 2, parallel: 3, delay: 400 },
     'lvl4': { name: 'LV4-MURDERER',    offset: 3, parallel: 2, delay: 1000 }
   };

  if (typeof window.plugin !== 'function') window.plugin = function () {};
  window.plugin.portalSlayer = window.plugin.portalSlayer || {};
  const S = window.plugin.portalSlayer;

  // 定数
  const KEY_DATA = 'plugin-portal-slayer-data';
  const KEY_CONFIG = 'plugin-portal-slayer-config';
  const KEY_OPTS = 'plugin-portal-slayer-options';
  const PANE_NAME = 'plugin-portal-slayer-pane';
  const PANE_ZINDEX = 650;

  // デフォルト設定
  const DEFAULT_CONFIG = {
    // レベル設定
    1: { active: false, color: '#CCCCCC' },
    2: { active: false, color: '#CCCCCC' },
    3: { active: false, color: '#CCCCCC' },
    4: { active: false, color: '#CCCCCC' },
    5: { active: false, color: '#CCCCCC' },
    6: { active: false, color: '#CCCCCC' },
    7: { active: true,  color: '#FFFF00' }, // 黄色
    8: { active: true,  color: '#FF0000' }, // 赤色

    // 陣営設定 (trueなら対象にする)
    processEnl: true,
    processRes: true
  };

  const DEFAULT_OPTS = {
    clearOnReload: false,
    linkPortalNames: true, // 従来のPortal Names連携
    forceNameLabel: true,  // 新機能: 強制的に名前を表示するか

    // Expert Mode Settings
    expertPreset: 'lvl0'
  };

  const DEFAULT_DATA = {
    version: 1,
    currentArea: 0,
    areas: [
      { name: 'Area1' },
      { name: 'Area2' },
      { name: 'Area3' },
      { name: 'Area4' },
      { name: 'Area5' }
    ],
    portals: {}
  };

  // 状態変数
  S.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  S.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  S.options = JSON.parse(JSON.stringify(DEFAULT_OPTS));
  S.layerGroup = null;
  S.isDeleteMode = false;
  S.guidToLayer = {};
  S.originalGetDataZoom = null; // Store original function for monkey-patching

  // ============================================================
  // Expert Mode Logic
  // ============================================================
  S.applyExpertOverrides = function() {
    const presetKey = S.options.expertPreset || 'lvl0';
    const preset = EXPERT_PRESETS[presetKey] || EXPERT_PRESETS['lvl0'];

    // 1. Data Zoom Override (God Eye)
    if (preset.offset !== 0) {
        if (!S.originalGetDataZoom) {
            S.originalGetDataZoom = window.getDataZoomForMapZoom;
        }
        window.getDataZoomForMapZoom = function(mapZoom) {
            let z = S.originalGetDataZoom(mapZoom);
            z += preset.offset;
            return Math.min(z, 21); // Cap at max
        };
    } else {
        // Restore original if offset is 0
        if (S.originalGetDataZoom) {
             window.getDataZoomForMapZoom = S.originalGetDataZoom;
             S.originalGetDataZoom = null;
        }
    }

    // 2. Request Throttling (Safety Control)
    if (window.mapDataRequest) {
        // Apply immediately
        window.mapDataRequest.MAX_REQUESTS = preset.parallel;
        window.mapDataRequest.RUN_QUEUE_DELAY = preset.delay;
    }
  };

  // ============================================================
  // ストレージ
  // ============================================================
  S.loadSettings = function() {
    try {
      const c = localStorage.getItem(KEY_CONFIG);
      if (c) {
        const parsed = JSON.parse(c);
        S.config = { ...DEFAULT_CONFIG, ...parsed };
        // Deep merge level settings to ensure new defaults
        for (let i = 1; i <= 8; i++) {
          if (S.config[i] && DEFAULT_CONFIG[i]) {
             S.config[i] = { ...DEFAULT_CONFIG[i], ...S.config[i] };
          }
        }
      }

      const o = localStorage.getItem(KEY_OPTS);
      if (o) {
        const parsed = JSON.parse(o);
        S.options = { ...DEFAULT_OPTS, ...parsed };
        // Remove legacy
        delete S.options.keepMarkersOnZoom;
        delete S.options.viewDistance;
        delete S.options.viewLevels;
        // Ensure preset
        if (!S.options.expertPreset) S.options.expertPreset = 'lvl0';
      }

      // Apply Expert Overrides after loading
      S.applyExpertOverrides();

    } catch(e) { console.error('Slayer loadSettings error', e); }
  };

  S.loadData = function() {
    try {
      if (S.options.clearOnReload) {
        S.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        S.saveData();
      } else {
        const d = localStorage.getItem(KEY_DATA);
        if (d) {
          const parsed = JSON.parse(d);
          // Check for legacy data (flat object without 'version' or 'portals')
          if (!parsed.version && !parsed.portals) {
            // Migrate legacy data to Area1
            S.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
            const guids = Object.keys(parsed);
            for (let i = 0; i < guids.length; i++) {
              const guid = guids[i];
              if (parsed[guid] && parsed[guid].lat) {
                S.data.portals[guid] = parsed[guid];
                S.data.portals[guid].areaIndex = 0; // Assign to Area1
              }
            }
            S.saveData(); // Save migrated structure
            console.log('PortalSlayer: Migrated legacy data to version 1');
          } else {
            // Load new structure
            S.data = parsed;
            // Ensure structure integrity (e.g. if new areas added in future)
            if (!S.data.areas) S.data.areas = DEFAULT_DATA.areas;
            if (S.data.currentArea === undefined) S.data.currentArea = 0;
          }
        } else {
          S.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        }
      }
    } catch(e) {
      console.error('Slayer loadData error', e);
      S.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  };

  S.saveSettings = function() {
    localStorage.setItem(KEY_CONFIG, JSON.stringify(S.config));
    localStorage.setItem(KEY_OPTS, JSON.stringify(S.options));
  };

  S.saveData = function() {
    try {
      localStorage.setItem(KEY_DATA, JSON.stringify(S.data));
    } catch(e) { console.error('Slayer saveData error', e); }
  };

  // ============================================================
  // マップ・マーカー処理
  // ============================================================
  S.ensureInfra = function() {
    if (!window.map || !window.L) return false;

    if (!map.getPane(PANE_NAME)) {
      map.createPane(PANE_NAME);
      const pane = map.getPane(PANE_NAME);
      pane.style.pointerEvents = 'none';
      pane.style.zIndex = PANE_ZINDEX;
    }

    if (!S.layerGroup) {
      S.layerGroup = new L.LayerGroup();
      // true = default visible
      window.addLayerGroup('Portal Slayer', S.layerGroup, true);
    }

    return true;
  };

  S.drawMarker = function(guid, latlng, color, title) {
    if (!S.ensureInfra()) return;

    if (S.guidToLayer[guid]) {
      S.layerGroup.removeLayer(S.guidToLayer[guid]);
      delete S.guidToLayer[guid];
    }

    const icon = L.divIcon({
      className: 'plugin-portal-slayer-marker',
      html: `<div style="color:${color}">▼</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 28]
    });

    const marker = L.marker(latlng, {
      icon: icon,
      interactive: true,
      pane: PANE_NAME
    });

    // --- 強制ラベル表示 ---
    // Note: Style inspired by Portal Names plugin
    if (S.options.forceNameLabel && title) {
      marker.bindTooltip(title, {
        permanent: true,
        direction: 'bottom',
        offset: [0, 5],
        className: 'plugin-portal-slayer-label'
      });
    }

    marker.on('click', function(e) {
      if (S.isDeleteMode) {
        L.DomEvent.stop(e);
        S.removePortal(guid);
      }
    });

    S.guidToLayer[guid] = marker;
    S.layerGroup.addLayer(marker);

    // 従来のPortal Names連携
    if (S.options.linkPortalNames && !S.options.forceNameLabel) {
      if (window.plugin.portalNames && window.plugin.portalNames.addLabel) {
        try {
          window.plugin.portalNames.addLabel(guid, latlng);
        } catch(e) {
          console.error('Portal Names integration error:', e);
        }
      }
    }
  };

  S.addPortal = function(guid, latlng, level, color, title) {
    // S.data.portals に保存。現在のエリアIDを付与。
    if (!S.data.portals) S.data.portals = {};

    S.data.portals[guid] = {
        lat: latlng.lat,
        lng: latlng.lng,
        level: level,
        color: color,
        title: title,
        areaIndex: S.data.currentArea
    };
    S.saveData();
    S.drawMarker(guid, latlng, color, title);

    // Update List View if open
    const listBody = $('#portal-slayer-list-body');
    if (listBody.length) {
        const existing = listBody.find(`tr[data-guid="${guid}"]`);
        const p = S.data.portals[guid];
        const newRow = S.createListRow(guid, p);
        if (existing.length) {
            existing.replaceWith(newRow);
        } else {
            listBody.append(newRow);
        }
    }
  };

  S.removePortal = function(guid) {
    if (S.data.portals && S.data.portals[guid]) {
      delete S.data.portals[guid];
      S.saveData();
    }
    if (S.guidToLayer[guid]) {
      S.layerGroup.removeLayer(S.guidToLayer[guid]);
      delete S.guidToLayer[guid];
    }
    // Update List View if open
    if ($('#portal-slayer-list-dialog').length > 0) {
        $(`tr[data-guid="${guid}"]`).remove();
    }
  };

  S.clearCurrentArea = function() {
    if (!S.data.portals) return;
    const guids = Object.keys(S.data.portals);
    let changed = false;
    guids.forEach(guid => {
        if (S.data.portals[guid].areaIndex === S.data.currentArea) {
            delete S.data.portals[guid];
            if (S.guidToLayer[guid]) {
                S.layerGroup.removeLayer(S.guidToLayer[guid]);
                delete S.guidToLayer[guid];
            }
            changed = true;
        }
    });
    if (changed) {
        S.saveData();
        if ($('#portal-slayer-list-dialog').length > 0) {
            S.openListView();
        }
    }
  };

  S.clearAll = function() {
    // Reset all portals
    S.data.portals = {};
    S.saveData();
    if (S.layerGroup) S.layerGroup.clearLayers();
    S.guidToLayer = {};

    if ($('#portal-slayer-list-dialog').length > 0) {
        $('#portal-slayer-list-body').empty();
    }
  };

  S.restoreAll = function() {
    if (!S.ensureInfra()) return;

    S.layerGroup.clearLayers();
    S.guidToLayer = {};

    if (!S.data.portals) return;

    const guids = Object.keys(S.data.portals);
    for (let i = 0; i < guids.length; i++) {
      try {
        const guid = guids[i];
        const d = S.data.portals[guid];

        const areaIdx = (d.areaIndex !== undefined) ? d.areaIndex : 0;

        // eslint-disable-next-line eqeqeq
        if (areaIdx == S.data.currentArea) {
            if (d && d.lat && d.lng && d.color) {
              let title = d.title;
              // データ補完
              if (!title) {
                const p = window.portals && window.portals[guid];
                if (p && p.options && p.options.data && p.options.data.title) {
                  title = p.options.data.title;
                  d.title = title;
                }
              }
              S.drawMarker(guid, {lat: d.lat, lng: d.lng}, d.color, title);
            }
        }
      } catch (e) {
        console.error('Slayer restoreAll error for item', e);
      }
    }
  };

  // ============================================================
  // Portal Names 連携フック
  // ============================================================
  S.setupPortalNamesHook = function() {
    if (window.plugin.portalNames && window.plugin.portalNames.updatePortalLabels) {
      const originalUpdate = window.plugin.portalNames.updatePortalLabels;
      window.plugin.portalNames.updatePortalLabels = function() {
        originalUpdate.apply(this, arguments);

        if (!S.options.linkPortalNames || S.options.forceNameLabel) return;

        if (!S.data.portals) return;
        const guids = Object.keys(S.data.portals);
        for (let i = 0; i < guids.length; i++) {
          const guid = guids[i];
          const d = S.data.portals[guid];
          const areaIdx = (d.areaIndex !== undefined) ? d.areaIndex : 0;

          if (d && areaIdx === S.data.currentArea) {
             window.plugin.portalNames.addLabel(guid, { lat: d.lat, lng: d.lng });
          }
        }
      };
    }
  };

  // ============================================================
  // インタラクション (ポータル選択時)
  // ============================================================
  S.onPortalSelected = function(data) {
    const guid = data.selectedPortalGuid;
    if (!guid) return;

    if (S.isDeleteMode) {
      if (S.data.portals && S.data.portals[guid]) {
        S.removePortal(guid);
      }
      return;
    }

    const p = window.portals[guid];
    if (!p) return;

    // --- 陣営チェック (Logic based on FlipChecker) ---
    const team = p.options.team;
    if (team === window.TEAM_RES && !S.config.processRes) return;
    if (team === window.TEAM_ENL && !S.config.processEnl) return;
    if (team === window.TEAM_NONE) return;

    // --- レベルチェック ---
    const detail = p.options.data;
    const level = detail ? Math.floor(detail.level) : 0;
    const title = detail ? detail.title : null;

    if (level > 0 && S.config[level] && S.config[level].active) {
      const existing = S.data.portals ? S.data.portals[guid] : null;

      if (!existing || existing.level !== level || existing.color !== S.config[level].color || (title && !existing.title) || existing.areaIndex !== S.data.currentArea) {
        S.addPortal(guid, p.getLatLng(), level, S.config[level].color, title);
      }
    }
  };

  // ============================================================
  // UI / 設定ダイアログ
  // ============================================================
  S.exportData = function() {
    const dataStr = JSON.stringify(S.data);
    const fileName = 'portal-slayer-data.json';

    try {
      // Android / IITC Mobile native interface
      if (typeof window.android !== 'undefined' && window.android && window.android.saveFile) {
        window.android.saveFile(fileName, 'application/json', dataStr);
        return;
      }

      // Generic IITC file saver helper (if available)
      if (typeof window.saveFile === 'function') {
        window.saveFile(dataStr, fileName, 'application/json');
        return;
      }

      // Standard HTML5 Download (PC)
      const blob = new Blob([dataStr], {type: "application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch(e) {
      console.error('Export failed:', e);
      // Fallback: Show data in dialog
      const safeData = dataStr.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const html = '<textarea style="width:100%; height:300px; font-family:monospace; box-sizing: border-box;" readonly>' + safeData + '</textarea>' +
                   '<p style="margin-top:8px;">Copy the text above and save it to a file (e.g. portal-slayer-data.json).</p>';

      if (typeof window.dialog === 'function') {
        window.dialog({
          html: html,
          title: 'Export Data (Fallback)',
          width: 'auto',
          dialogClass: 'ui-dialog-portal-slayer-export ui-dialog-portal-slayer',
          position: { my: 'center', at: 'center', of: window },
          draggable: true
        });
      } else {
        alert('Export failed. Copy data manually from console if possible.');
      }
    }
  };

  S.importData = function(file) {
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (confirm('既存データが上書きされます。よろしいですか？')) {
          // Validate structure a bit?
          if (data.portals || data.version) {
              S.data = data;
          } else {
              // Legacy import?
              // Wrap it
              S.data = JSON.parse(JSON.stringify(DEFAULT_DATA));
              const guids = Object.keys(data);
                for (let i = 0; i < guids.length; i++) {
                  const guid = guids[i];
                  if (data[guid] && data[guid].lat) {
                    S.data.portals[guid] = data[guid];
                    S.data.portals[guid].areaIndex = 0;
                  }
                }
          }

          // Ensure data integrity
          if (!S.data.areas) S.data.areas = JSON.parse(JSON.stringify(DEFAULT_DATA.areas));
          if (S.data.currentArea === undefined) S.data.currentArea = 0;
          if (!S.data.portals) S.data.portals = {};

          S.saveData();
          S.restoreAll();
          alert('インポートに成功しました！');
        }
      } catch(e) {
        alert('インポートエラー: ' + e);
      }
    };
    reader.readAsText(file);
  };

  S.openListView = function() {
      // Build List HTML
      // Filters?
      const html = `
        <div class="ps-list-view">
            <div class="ps-list-controls">
                <input type="text" id="ps-list-search" placeholder="ポータル名を検索..." style="width: 100%; box-sizing: border-box; padding: 4px;">
            </div>
            <div class="ps-list-container" style="max-height: 400px; overflow-y: auto; margin-top: 8px;">
                <table id="ps-list-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="text-align: left;">Name</th>
                            <th style="width: 40px;">Lvl</th>
                            <th style="width: 60px;">Area</th>
                            <th style="width: 50px;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="portal-slayer-list-body">
                    </tbody>
                </table>
            </div>
        </div>
      `;

      const dialog = window.dialog({
        html: html,
        id: 'portal-slayer-list-dialog',
        dialogClass: 'ui-dialog-portal-slayer',
        title: 'PortalSlayer List View',
        width: 'auto',
        height: 'auto',
        position: { my: 'center', at: 'center', of: window },
        draggable: true
      });

      const tbody = $('#portal-slayer-list-body');

      if (!S.data.portals) return;

      const guids = Object.keys(S.data.portals);
      guids.forEach(guid => {
         const p = S.data.portals[guid];
         if (!p) return;
         tbody.append(S.createListRow(guid, p));
      });

      // Filter Logic
      $('#ps-list-search').on('input', function() {
          const val = this.value.toLowerCase();
          $('#portal-slayer-list-body tr').each(function() {
             const text = $(this).find('.ps-list-name').text().toLowerCase();
             if (text.indexOf(val) > -1) {
                 $(this).show();
             } else {
                 $(this).hide();
             }
          });
      });

      // Jump Logic (Event Delegation)
      $('#portal-slayer-list-body').on('click', '.ps-list-jump', function() {
          const lat = $(this).data('lat');
          const lng = $(this).data('lng');
          window.map.setView([lat, lng], 15);
      });
  };

  S.createListRow = function(guid, p) {
      const areaName = S.data.areas[p.areaIndex || 0].name;
      const title = p.title || 'Unknown';
      const lvl = p.level || '?';

      const row = $('<tr>').attr('data-guid', guid).css('border-bottom', '1px solid #444');

      $('<td>').addClass('ps-list-name')
               .css({ 'white-space': 'normal', 'word-break': 'break-all', 'padding': '4px' })
               .text(title).appendTo(row);

      $('<td>').css('text-align', 'center').text('P' + lvl).appendTo(row);

      $('<td>').css({ 'text-align': 'center', 'font-size': '0.9em' }).text(areaName).appendTo(row);

      const btnTd = $('<td>').css('text-align', 'center').appendTo(row);
      $('<button>').addClass('ps-list-jump')
                   .data('lat', p.lat)
                   .data('lng', p.lng)
                   .text('JUMP')
                   .appendTo(btnTd);

      return row;
  };

  S.openSettings = function() {
    const currentAreaIdx = S.data.currentArea || 0;
    const areas = S.data.areas || DEFAULT_DATA.areas;

    // Area Tabs HTML
    let areaTabs = '<div class="ps-area-tabs" style="display:flex; gap:4px; margin-bottom:8px; flex-wrap:wrap;">';
    areas.forEach((area, idx) => {
        const isActive = (idx === currentAreaIdx);
        areaTabs += `<button class="ps-area-tab ${isActive ? 'active' : ''}" data-idx="${idx}" style="flex:1; padding:4px; font-size:12px; border:1px solid #555; background:${isActive?'#004400':'#222'}; color:#eee;">${area.name}</button>`;
    });
    areaTabs += '</div>';

    // Rename Control
    const renameControl = `
        <div style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
            <input type="text" id="ps-area-rename" value="${areas[currentAreaIdx].name}" style="flex:1; padding: 4px;">
            <button id="ps-btn-rename">エリア名変更</button>
        </div>
    `;

    // Presets Dropdown
    let presetOptions = '';
    for (const key in EXPERT_PRESETS) {
      const p = EXPERT_PRESETS[key];
      const selected = (S.options.expertPreset === key) ? 'selected' : '';
      presetOptions += `<option value="${key}" ${selected}>${p.name}</option>`;
    }

    const html = `
      <div class="portal-slayer-settings">
        <div class="ps-header">
           <div style="font-weight:bold; color:#ddd; margin-bottom:4px;">▼マーカーを付けたいエリア選択:</div>
           ${areaTabs}
           ${renameControl}

           <div><label><input type="checkbox" id="ps-clear-reload" ${S.options.clearOnReload ? 'checked' : ''}> リロードで全消去する</label></div>

           <div style="margin-top:8px; border-top:1px solid #444; padding-top:4px;">
             <div style="font-weight:bold; color:#ddd;">ラベル表示設定:</div>
             <div><label><input type="checkbox" id="ps-force-label" ${S.options.forceNameLabel ? 'checked' : ''}> 強制ラベル表示 (Portal Names OFFでも表示)</label></div>
             <div style="color:#888; font-size:11px; margin-left:16px;">※Portal Namesプラグイン連携: <label><input type="checkbox" id="ps-link-names" ${S.options.linkPortalNames ? 'checked' : ''} ${S.options.forceNameLabel ? 'disabled' : ''}> ON</label></div>
           </div>

           <div style="margin-top:8px; border-top:1px solid #444; padding-top:4px;">
             <div style="font-weight:bold; color:#ddd;">データ管理:</div>
             <div style="margin-top:4px; display:flex; flex-wrap:wrap; gap:4px;">
               <button id="ps-btn-list-view" style="font-weight:bold;">リスト表示</button>
               <button id="ps-btn-export">データ保存 (Export)</button>
               <button id="ps-btn-import" onclick="document.getElementById('ps-file-import').click()">データ読込 (Import)</button>
               <input type="file" id="ps-file-import" style="display:none" accept=".json">
             </div>
           </div>

           <div style="margin-top:8px; border-top:1px solid #444; padding-top:4px;">
             <div style="font-weight:bold; color:#ff5555;">ZoomLv下げてもポータル表示を増やす</div>
             <div style="color:#f88; font-size:11px; margin-bottom:4px;">注意⚠️非COREユーザの場合アクセス規制されやすいです</div>

             <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
               <label style="flex:1;">動作モード(リロード推奨):</label>
               <select id="ps-expert-preset" style="flex:1;">
                 ${presetOptions}
               </select>
             </div>
           </div>
        </div>

        <div class="ps-team-select">
           <span style="font-weight:bold; margin-right:8px;">マーカー対象の陣営とポータルLV:</span>
           <label class="ps-team-label enl"><input type="checkbox" id="ps-check-enl" ${S.config.processEnl ? 'checked' : ''}> Enl</label>
           <label class="ps-team-label res"><input type="checkbox" id="ps-check-res" ${S.config.processRes ? 'checked' : ''}> Res</label>
        </div>

        <table class="ps-level-table">
          <tr><th>Lv</th><th>自動</th><th>色</th></tr>
          ${[1,2,3,4,5,6,7,8].map(lvl => {
            const c = S.config[lvl];
            return `
              <tr>
                <td>L${lvl}</td>
                <td><input type="checkbox" class="ps-lvl-check" data-lvl="${lvl}" ${c.active ? 'checked' : ''}></td>
                <td><input type="color" class="ps-lvl-color" data-lvl="${lvl}" value="${c.color}"></td>
              </tr>
            `;
          }).join('')}
        </table>
        <div class="ps-controls">
          <button id="ps-btn-delete-mode" class="${S.isDeleteMode ? 'active' : ''}">${S.isDeleteMode ? '削除モード中 (Mapタップ)' : '削除モード OFF'}</button>
          <div style="display:flex; gap:4px;">
            <button id="ps-btn-clear-current" class="danger" style="flex:1;">削除 (選択エリアのみ)</button>
            <button id="ps-btn-clear-all" class="danger" style="flex:1;">全削除 (全エリア)</button>
          </div>
        </div>
      </div>
    `;

    window.dialog({
      html: html,
      id: 'plugin-portal-slayer-dialog',
      dialogClass: 'ui-dialog-portal-slayer',
      title: 'PortalSlayer Options',
      width: 'auto',
      position: { my: 'center', at: 'center', of: window },
      draggable: true
    });

    // イベントハンドラ
    // Area Switching
    $('.ps-area-tab').on('click', function() {
        const idx = $(this).data('idx');
        if (S.data.currentArea !== idx) {
            S.data.currentArea = idx;
            S.saveData();
            // Redraw UI to update tabs and rename input
            $('#plugin-portal-slayer-dialog').dialog('close');
            S.openSettings();
            // Redraw Markers
            S.restoreAll();
        }
    });

    // Rename Area
    $('#ps-btn-rename').on('click', function() {
        const newName = $('#ps-area-rename').val();
        if (newName) {
            S.data.areas[S.data.currentArea].name = newName;
            S.saveData();
            // Refresh Tabs
            $('#plugin-portal-slayer-dialog').dialog('close');
            S.openSettings();
        }
    });

    $('#ps-clear-reload').on('change', function() { S.options.clearOnReload = this.checked; S.saveSettings(); });

    $('#ps-force-label').on('change', function() {
        S.options.forceNameLabel = this.checked;
        $('#ps-link-names').prop('disabled', this.checked);
        S.saveSettings();
        S.restoreAll();
    });

    $('#ps-link-names').on('change', function() { S.options.linkPortalNames = this.checked; S.saveSettings(); });

    // Expert Mode Event Handlers (Updated for Presets)
    $('#ps-expert-preset').on('change', function() {
        S.options.expertPreset = this.value;
        S.saveSettings();
        S.applyExpertOverrides();
    });

    $('#ps-check-enl').on('change', function() { S.config.processEnl = this.checked; S.saveSettings(); });
    $('#ps-check-res').on('change', function() { S.config.processRes = this.checked; S.saveSettings(); });

    $('.ps-lvl-check').on('change', function() {
      const lvl = $(this).data('lvl');
      S.config[lvl].active = this.checked;
      S.saveSettings();
    });
    $('.ps-lvl-color').on('change', function() {
      const lvl = $(this).data('lvl');
      S.config[lvl].color = this.value;
      S.saveSettings();
    });

    $('#ps-btn-delete-mode').on('click', function() {
      S.toggleDeleteMode();
      $(this).text(S.isDeleteMode ? '削除モード中 (Mapタップ)' : '削除モード OFF');
      $(this).toggleClass('active', S.isDeleteMode);
    });

    $('#ps-btn-clear-current').on('click', function() {
      if(confirm('警告: 選択中のエリアのマーカーを全て削除しますか？')) {
        S.clearCurrentArea();
      }
    });

    $('#ps-btn-clear-all').on('click', function() {
      if(confirm('警告: 全てのエリアの全てのマーカーを削除しますか？')) {
        S.clearAll();
      }
    });

    $('#ps-btn-export').on('click', function() {
      S.exportData();
    });

    $('#ps-btn-list-view').on('click', function() {
        S.openListView();
    });

    $('#ps-file-import').on('change', function(e) {
      if (this.files && this.files[0]) {
        S.importData(this.files[0]);
      }
      // Reset input so the same file can be selected again if needed
      this.value = '';
    });
  };

  S.toggleDeleteMode = function() {
    S.isDeleteMode = !S.isDeleteMode;
    if (S.isDeleteMode) {
      $(document.body).addClass('ps-delete-mode-active');
    } else {
      $(document.body).removeClass('ps-delete-mode-active');
    }
  };

  S.addToolboxLink = function() {
    $('#ps-toolbox-link').remove();
    $('#toolbox').append('<a id="ps-toolbox-link" onclick="window.plugin.portalSlayer.openSettings();return false;">PortalSlayer</a>');
  }

  S.setupZoomDisplay = function() {
    if ($('#portal-slayer-zoom-display').length === 0) {
      $('<div>')
        .prop('id', 'portal-slayer-zoom-display')
        .appendTo('body');
    }

    const updateDisplay = function() {
       if (window.map) {
         const zoom = window.map.getZoom();

         // Calculate View Width
         const bounds = window.map.getBounds();
         const center = bounds.getCenter();
         const west = L.latLng(center.lat, bounds.getWest());
         const east = L.latLng(center.lat, bounds.getEast());
         const dist = window.map.distance(west, east);

         let distStr = '';
         if (dist >= 1000) {
           distStr = (dist / 1000).toFixed(1) + 'km';
         } else {
           distStr = Math.round(dist) + 'm';
         }

         $('#portal-slayer-zoom-display').text(`ZoomLv: ${zoom} (幅: ${distStr})`);
       }
    };

    updateDisplay();
    window.map.on('zoomend', updateDisplay);
    window.map.on('moveend', updateDisplay);
  };

  S.setupPortalCounter = function() {
    if ($('#portal-slayer-counter').length === 0) {
      $('<div>')
        .prop('id', 'portal-slayer-counter')
        .css('bottom', UI_COUNTER_BOTTOM)
        .appendTo('body');
    }
    S.updatePortalCounter();
    setInterval(S.updatePortalCounter, COUNTER_UPDATE_INTERVAL);
  };

  S.updatePortalCounter = function() {
    let enlTotal = 0;
    let enlL8 = 0;
    let resTotal = 0;
    let resL8 = 0;

    if (window.portals) {
      const guids = Object.keys(window.portals);
      for (let i = 0; i < guids.length; i++) {
         const p = window.portals[guids[i]];
         // In IITC, p.options.data contains portal detail if available
         if (p && p.options) {
             const team = p.options.team;
             const lvl = (p.options.data && p.options.data.level) ? p.options.data.level : 0;
             if (team === window.TEAM_ENL) {
                 enlTotal++;
                 if (lvl === 8) enlL8++;
             } else if (team === window.TEAM_RES) {
                 resTotal++;
                 if (lvl === 8) resL8++;
             }
         }
      }
    }
    $('#portal-slayer-counter').html(`E-P8 : ${enlL8} / ${enlTotal}<br>R-P8 : ${resL8} / ${resTotal}`);
  };

  S.setupCSS = function() {
    if ($('#portal-slayer-css').length === 0) {
      $('<style>').prop('id', 'portal-slayer-css').prop('type', 'text/css').html(`
        .plugin-portal-slayer-marker {
          font-size: 20px;
          line-height: 20px;
          text-align: center;
          text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
          pointer-events: none;
        }
        /* Style based on Portal Names plugin */
        .plugin-portal-slayer-label {
          background-color: transparent !important;
          border: none !important;
          box-shadow: none !important;
          font-size: 11px;
          color: #FFFFFF;
          font-family: sans-serif;
          text-align: center;
          text-shadow: 0 0 0.2em black, 0 0 0.2em black, 0 0 0.2em black;
          pointer-events: none;
          margin-top: 0 !important;
        }
        .plugin-portal-slayer-label:before { display: none; }

        body.ps-delete-mode-active .plugin-portal-slayer-marker {
          pointer-events: auto;
          cursor: crosshair;
        }
        .portal-slayer-settings { font-size: 14px; }
        .ps-header { margin-bottom: 8px; }
        .ps-header div { margin-bottom: 4px; }

        .ps-team-select { margin-bottom: 10px; padding: 6px; border: 1px solid #444; background: #222; border-radius: 4px; }
        .ps-team-label { margin-right: 12px; font-weight: bold; cursor: pointer; }
        .ps-team-label.enl { color: #03fe03; }
        .ps-team-label.res { color: #00c5ff; }

        .ps-level-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        .ps-level-table th { text-align: center; border-bottom: 1px solid #555; }
        .ps-level-table td { text-align: center; padding: 4px; border-bottom: 1px solid #333; }
        .ps-controls { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
        .ps-controls button { padding: 6px; border: 1px solid #555; background: #222; color: #eee; cursor: pointer; }
        .ps-controls button.active { background: #600; border-color: #f00; }
        .ps-controls button.danger { color: #f88; border-color: #844; }

        #portal-slayer-zoom-display, #portal-slayer-counter {
          position: fixed;
          right: 2px;
          background: rgba(0,0,0,0.5);
          color: #FFF;
          padding: 2px 5px;
          border-radius: 4px;
          font-size: 10px;
          pointer-events: none;
          z-index: 6000;
          font-family: monospace;
          white-space: nowrap;
        }
        #portal-slayer-zoom-display {
           bottom: ${UI_ZOOM_BOTTOM};
        }

        @media only screen and (max-width: 800px) {
          .ui-dialog-portal-slayer {
            max-width: 95% !important;
            width: 95% !important;
            left: 50% !important;
            top: 50% !important;
            transform: translate(-50%, -50%) !important;
            position: fixed !important;
          }
          .ui-dialog-portal-slayer .ui-dialog-titlebar {
            padding: 12px 10px !important;
          }
          .ui-dialog-portal-slayer .ui-dialog-title {
            font-size: 1.1em;
            line-height: 1.2em;
          }
          .ui-dialog-portal-slayer .ui-dialog-content {
            max-height: 70vh !important;
            overflow-y: auto !important;
          }
        }
      `).appendTo('head');
    }
  };

  // ============================================================
  // ブートストラップ
  // ============================================================
  function setup() {
    try {
      S.setupCSS();
      S.loadSettings();
      S.loadData();

      S.addToolboxLink();
      setInterval(S.addToolboxLink, 2000);

      const initMap = setInterval(function() {
        if (window.map && window.L) {
          S.ensureInfra();
          S.restoreAll();

          // Apply overrides once map is ready (for throttling if depends on mapDataRequest)
          S.applyExpertOverrides();

          window.removeHook('portalSelected', S.onPortalSelected);
          window.addHook('portalSelected', S.onPortalSelected);

          S.setupZoomDisplay();
          S.setupPortalCounter();

          setTimeout(S.setupPortalNamesHook, 1000);

          clearInterval(initMap);
        }
      }, 500);

    } catch(e) {
      console.error('PortalSlayer setup error:', e);
    }
  }

  setup.info = plugin_info;
  if (!window.bootPlugins) window.bootPlugins = [];
  window.bootPlugins.push(setup);
  if (window.iitcLoaded) setup();
}

(function() {
  var info = { "script": { "name": "IITC plugin: PortalSlayer", "version": "0.9.23", "description": "[0.9.23] Faction-based Portal Counter" } };
  var script = document.createElement('script');
  script.appendChild(document.createTextNode('(' + wrapper + ')(' + JSON.stringify(info) + ');'));
  (document.body || document.head || document.documentElement).appendChild(script);
})();
