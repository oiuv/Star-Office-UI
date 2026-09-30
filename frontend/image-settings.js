(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const TEXT = {
    zh:{base:'API 地址（含 /v1 等服务前缀）',model:'图片模型',mode:'生成方式',edit:'参考图编辑（保持房间布局）',generate:'纯文生图（服务不支持编辑时选择）',save:'保存设置',hint:'OpenAI 兼容 Image API；留空 Key 可保留已保存的密钥。',key:'API Key（留空保留已有值）',doc:'Image API 文档',loading:'读取配置失败',saved:'已保存，可以开始装修',failed:'保存失败',stats:'📊 活动档案',fast:'⚡ 快速',quality:'✦ 精细'},
    en:{base:'API base URL (include /v1 if required)',model:'Image model',mode:'Image mode',edit:'Reference edit (preserve room layout)',generate:'Text to image (for generation-only services)',save:'Save settings',hint:'OpenAI-compatible Image API. Leave the key blank to keep the saved key.',key:'API key (blank keeps saved value)',doc:'Image API documentation',loading:'Could not load settings',saved:'Saved. Ready to decorate.',failed:'Could not save',stats:'📊 Activity log',fast:'⚡ Fast',quality:'✦ Fine'},
    ja:{base:'API URL（必要なら /v1 を含む）',model:'画像モデル',mode:'生成方式',edit:'参照画像の編集（配置を維持）',generate:'テキストから生成（編集非対応のサービス）',save:'設定を保存',hint:'OpenAI 互換 Image API。キーを空にすると保存済みの値を保持します。',key:'API キー（空欄で保持）',doc:'Image API ドキュメント',loading:'設定の取得に失敗',saved:'保存しました。模様替えできます。',failed:'保存に失敗',stats:'📊 活動記録',fast:'⚡ 高速',quality:'✦ 高品質'}
  };
  const language = () => { try { return typeof uiLang === 'string' && TEXT[uiLang] ? uiLang : 'zh'; } catch (_) { return 'zh'; } };
  const t = key => TEXT[language()][key];
  function labels() {
    for (const [id,key] of [['image-base-label','base'],['image-model-label','model'],['image-mode-label','mode'],['image-mode-edit','edit'],['image-mode-generate','generate'],['btn-save-image-key','save'],['image-config-hint','hint'],['image-api-doc-link','doc'],['office-stats-link','stats'],['speed-fast-btn','fast'],['speed-quality-btn','quality']]) {
      if ($(id)) $(id).textContent = t(key);
    }
    if ($('image-api-key-input')) $('image-api-key-input').placeholder = t('key');
  }
  async function load() {
    const auth = await fetch('/assets/auth/status',{cache:'no-store'}).then(r => r.json());
    assetDrawerAuthed = !!(auth.ok && auth.authed);
    updateAssetAuthUI(); labels();
    if (!assetDrawerAuthed) return;
    const response = await fetch('/config/ai',{cache:'no-store'});
    const config = await response.json();
    if (!response.ok || !config.ok) throw new Error(config.msg || response.status);
    window.imageConfig = {hasKey:config.has_api_key,model:config.model};
    $('image-base-url-input').value = config.base_url;
    $('image-model-input').value = config.model;
    $('image-mode-input').value = config.image_mode;
    $('image-mask-status').textContent = config.has_api_key ? t('key') + ': ' + config.api_key_masked : 'API Key: —';
  }
  async function save() {
    const msg = $('image-config-msg'), button = $('btn-save-image-key');
    button.disabled = true;
    try {
      const response = await fetch('/config/ai',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          api_key:$('image-api-key-input').value.trim(),
          base_url:$('image-base-url-input').value.trim(),
          model:$('image-model-input').value.trim(),
          image_mode:$('image-mode-input').value
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.msg || response.status);
      $('image-api-key-input').value = ''; msg.textContent = t('saved'); await load();
    } catch (error) { msg.textContent = t('failed') + ': ' + error.message; }
    finally { button.disabled = false; }
  }
  window.StarImageSettings = {load,save,labels};
  document.addEventListener('DOMContentLoaded',labels);
  document.addEventListener('click',event => { if (event.target.id?.startsWith('lang-btn')) labels(); });
})();
