// ==UserScript==
// @author         You
// @name           IITC plugin: PortalSlayer
// @category       d.org.addon
// @version        0.9.2
// @description    [0.9.2]Android向け。指定レベル・陣営のポータルをタップ時にマーカー(▼)付与。ポータル名強制表示対応。
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
     - Concept of displaying portal labels on the map.
     - CSS styles for text labels (shadows, fonts) are based on its implementation.
     - Note: This plugin implements a simplified version of labeling and does not include
       the full collision detection logic of the original Portal Names.

  2. IITC plugin: Portal Audit / Portal Audit Mini
     - Marker management infrastructure (Pane/Layer handling).
     - Secure LocalStorage handling logic to prevent data corruption.

  3. IITC: FlipChecker
     - Faction filtering logic (Enl/Res/Neutral detection).

  All credit for the original logic goes to their respective authors.
  This plugin is an independent modification and is not supported by the original authors.
*/

function wrapper(plugin_info) {
  'use strict';

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
    forceNameLabel: true   // 新機能: 強制的に名前を表示するか
  };

  // 状態変数
  S.data = {};
  S.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  S.options = JSON.parse(JSON.stringify(DEFAULT_OPTS));
  S.layerGroup = null;
  S.isDeleteMode = false;
  S.guidToLayer = {};

  // ============================================================
  // ストレージ
  // ============================================================
  S.loadSettings = function() {
    try {
      const c = localStorage.getItem(KEY_CONFIG);
      if (c) S.config = { ...DEFAULT_CONFIG, ...JSON.parse(c) };

      const o = localStorage.getItem(KEY_OPTS);
      if (o) S.options = { ...DEFAULT_OPTS, ...JSON.parse(o) };
    } catch(e) { console.error('Slayer loadSettings error', e); }
  };

  S.loadData = function() {
    try {
      if (S.options.clearOnReload) {
        S.data = {};
        S.saveData();
      } else {
        const d = localStorage.getItem(KEY_DATA);
        S.data = d ? JSON.parse(d) : {};
      }
    } catch(e) {
      console.error('Slayer loadData error', e);
      S.data = {};
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
        window.plugin.portalNames.addLabel(guid, latlng);
      }
    }
  };

  S.addPortal = function(guid, latlng, level, color, title) {
    S.data[guid] = { lat: latlng.lat, lng: latlng.lng, level: level, color: color, title: title };
    S.saveData();
    S.drawMarker(guid, latlng, color, title);
  };

  S.removePortal = function(guid) {
    if (S.data[guid]) {
      delete S.data[guid];
      S.saveData();
    }
    if (S.guidToLayer[guid]) {
      S.layerGroup.removeLayer(S.guidToLayer[guid]);
      delete S.guidToLayer[guid];
    }
  };

  S.clearAll = function() {
    S.data = {};
    S.saveData();
    if (S.layerGroup) S.layerGroup.clearLayers();
    S.guidToLayer = {};
  };

  S.restoreAll = function() {
    if (!S.ensureInfra()) return;

    S.layerGroup.clearLayers();
    S.guidToLayer = {};

    const guids = Object.keys(S.data);
    for (let i = 0; i < guids.length; i++) {
      const guid = guids[i];
      const d = S.data[guid];
      if (d && d.lat && d.lng && d.color) {
        let title = d.title;
        // データ補完
        if (!title && window.portals[guid] && window.portals[guid].options.data.title) {
            title = window.portals[guid].options.data.title;
            d.title = title;
        }
        S.drawMarker(guid, {lat: d.lat, lng: d.lng}, d.color, title);
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

        const guids = Object.keys(S.data);
        for (let i = 0; i < guids.length; i++) {
          const guid = guids[i];
          const d = S.data[guid];
          if (d) {
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
      if (S.data[guid]) {
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
      const existing = S.data[guid];
      if (!existing || existing.level !== level || existing.color !== S.config[level].color || (title && !existing.title)) {
        S.addPortal(guid, p.getLatLng(), level, S.config[level].color, title);
      }
    }
  };

  // ============================================================
  // UI / 設定ダイアログ
  // ============================================================
  S.openSettings = function() {
    const html = `
      <div class="portal-slayer-settings">
        <div class="ps-header">
           <div><label><input type="checkbox" id="ps-clear-reload" ${S.options.clearOnReload ? 'checked' : ''}> リロードで全消去する</label></div>

           <div style="margin-top:8px; border-top:1px solid #444; padding-top:4px;">
             <div style="font-weight:bold; color:#ddd;">Label Options:</div>
             <div><label><input type="checkbox" id="ps-force-label" ${S.options.forceNameLabel ? 'checked' : ''}> 強制ラベル表示 (Portal Names OFFでも表示)</label></div>
             <div style="color:#888; font-size:11px; margin-left:16px;">※Portal Namesプラグイン連携: <label><input type="checkbox" id="ps-link-names" ${S.options.linkPortalNames ? 'checked' : ''} ${S.options.forceNameLabel ? 'disabled' : ''}> ON</label></div>
           </div>
        </div>

        <div class="ps-team-select">
           <span style="font-weight:bold; margin-right:8px;">Target:</span>
           <label class="ps-team-label enl"><input type="checkbox" id="ps-check-enl" ${S.config.processEnl ? 'checked' : ''}> Enl</label>
           <label class="ps-team-label res"><input type="checkbox" id="ps-check-res" ${S.config.processRes ? 'checked' : ''}> Res</label>
        </div>

        <table class="ps-level-table">
          <tr><th>Lvl</th><th>Auto</th><th>Color</th></tr>
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
          <button id="ps-btn-clear-all" class="danger">全マーカー削除</button>
        </div>
      </div>
    `;

    window.dialog({
      html: html,
      id: 'plugin-portal-slayer-dialog',
      title: 'PortalSlayer Options',
      width: 'auto'
    });

    // イベントハンドラ
    $('#ps-clear-reload').on('change', function() { S.options.clearOnReload = this.checked; S.saveSettings(); });

    $('#ps-force-label').on('change', function() {
        S.options.forceNameLabel = this.checked;
        $('#ps-link-names').prop('disabled', this.checked);
        S.saveSettings();
        S.restoreAll();
    });

    $('#ps-link-names').on('change', function() { S.options.linkPortalNames = this.checked; S.saveSettings(); });

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

    $('#ps-btn-clear-all').on('click', function() {
      if(confirm('全てのマーカーを削除しますか？')) {
        S.clearAll();
      }
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

          window.removeHook('portalSelected', S.onPortalSelected);
          window.addHook('portalSelected', S.onPortalSelected);

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
  var info = { "script": { "name": "IITC plugin: PortalSlayer", "version": "0.9.1", "description": "Android向け。指定レベル・陣営のポータルをタップ時にマーカー(▼)付与。ポータル名強制表示対応。" } };
  var script = document.createElement('script');
  script.appendChild(document.createTextNode('(' + wrapper + ')(' + JSON.stringify(info) + ');'));
  (document.body || document.head || document.documentElement).appendChild(script);
})();
