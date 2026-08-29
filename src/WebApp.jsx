import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import {
  Bell,
  BookOpen,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  FolderOpen,
  FolderOutput,
  FileSpreadsheet,
  ImagePlus,
  Images,
  LayoutDashboard,
  LoaderCircle,
  Link2,
  LockKeyhole,
  KeyRound,
  LogOut,
  Menu,
  PackageSearch,
  Pause,
  Play,
  Plus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Upload,
  Users,
  WandSparkles,
  X,
  Trash2,
} from "lucide-react";
import "./web-styles.css";
import {
  buildAttributeFields,
  flattenLeafCategories,
} from "./lib/shein-template-contract.js";
import {
  buildPublishProduct,
  classifyPublishImage,
  formatImageSize,
  validatePublishImage,
} from "./lib/publish-image-rules.js";
import {
  calculateAreaSquareMeters,
  calculateWeightGrams,
  createSizeRow,
  enrichSizeRows,
  normalizePackagingWorkbook,
} from "./lib/package-template.js";
import {
  applySheinSizeOption,
  parseSheinSizeLabel,
} from "./lib/shein-size-template.js";
import {
  cropImageFile,
  isSheinMainImageReady,
  SHEIN_MAIN_IMAGE_PRESETS,
} from "./lib/main-image-crop.js";
import {
  attachBatchImageAssets,
  buildUniqueBatchSupplierCodes,
  isDraftReadyForBatch,
} from "./lib/web-batch-import.js";

const roleLabels = {
  owner: "负责人",
  admin: "管理员",
  operator: "运营",
  viewer: "只读成员",
};

const sheinNavigation = [
  { id: "overview", label: "运营总览", icon: LayoutDashboard, ready: true },
  { id: "products", label: "商品工作台", icon: PackageSearch },
  { id: "compliance", label: "合规中心", icon: ShieldCheck },
  { id: "audits", label: "审核任务", icon: ClipboardCheck },
  { id: "members", label: "成员权限", icon: Users },
];

const navigation = sheinNavigation;

const publishCategoryClientCache = new Map();
const publishSchemaClientCache = new Map();

async function cachedClientRequest(cache, key, loader) {
  const existing = cache.get(key);
  if (existing?.value) return existing.value;
  if (existing?.promise) return existing.promise;
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      cache.set(key, { value, promise: null });
      return value;
    })
    .catch((error) => {
      cache.delete(key);
      throw error;
    });
  cache.set(key, { value: null, promise });
  return promise;
}

async function requestWebApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 413
      ? "保存内容超过网关限制，请刷新后重试；图片应直传对象存储，不会写入模板JSON"
      : `网页服务请求失败 (${response.status})`;
    const error = new Error(payload.msg || fallback);
    error.code = payload.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function uploadWebMediaFile({ storeId, file, purpose }) {
  const uploadFile = await prepareWebImageFile(file);
  const dimensionsPromise = uploadFile.type.startsWith("image/") && uploadFile.type !== "image/avif"
    ? readImageDimensions(uploadFile)
    : Promise.resolve({ width: null, height: null });
  const ticket = await requestWebApi(
    `/v1/web/stores/${encodeURIComponent(storeId)}/media/upload-ticket`,
    {
      method: "POST",
      body: JSON.stringify({
        originalName: uploadFile.name,
        contentType: uploadFile.type,
        sizeBytes: uploadFile.size,
        purpose,
      }),
    },
  );
  const uploaded = await fetch(ticket.upload.url, {
    method: ticket.upload.method,
    headers: ticket.upload.headers,
    body: uploadFile,
  });
  if (!uploaded.ok) {
    throw new Error(
      `对象存储上传失败 (${uploaded.status})，请检查存储桶跨域设置`,
    );
  }
  const dimensions = await dimensionsPromise;
  const completed = await requestWebApi(
    `/v1/web/stores/${encodeURIComponent(storeId)}/media/${encodeURIComponent(ticket.asset.id)}/complete`,
    {
      method: "POST",
      body: JSON.stringify(dimensions),
    },
  );
  return completed.asset;
}

async function prepareWebImageFile(file) {
  if (file?.type) return file;
  const inferredType = /\.jpe?g$/i.test(file?.name || "")
    ? "image/jpeg"
    : /\.png$/i.test(file?.name || "")
      ? "image/png"
      : /\.webp$/i.test(file?.name || "")
        ? "image/webp"
        : /\.avif$/i.test(file?.name || "")
          ? "image/avif"
          : "";
  return inferredType
    ? new File([file], file.name, {
        type: inferredType,
        lastModified: file.lastModified || Date.now(),
      })
    : file;
}

function LoginScreen({ onAuthenticated }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setNotice("请输入邮箱和密码");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const session = await requestWebApi("/v1/web/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      onAuthenticated(session);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="web-login">
      <section className="web-login__story">
          <div className="web-brand web-brand--light">
            <span className="web-brand__mark">图</span>
            <span>
            <strong>SHEIN 全托管运营助手</strong>
            <small>多店铺 · 商品 · 合规 · 发布</small>
            </span>
          </div>
        <div className="web-login__message">
          <span className="web-eyebrow">团队工作台</span>
          <h1>20 家店铺，<br />在一个地方协同。</h1>
          <p>商品发布、合规资料、审核事件和店铺经营统一流转。永久店铺密钥不会进入浏览器。</p>
          <div className="web-login__proofs">
            <span><CheckCircle2 size={17} /> 选中商品立即查看资料</span>
            <span><CheckCircle2 size={17} /> 统一管理商品与审核状态</span>
            <span><CheckCircle2 size={17} /> 发布进度实时可追踪</span>
          </div>
        </div>
        <small className="web-login__foot">内部运营平台 · 仅授权成员可访问</small>
      </section>

      <section className="web-login__panel">
        <form className="web-login__card" onSubmit={submit}>
          <div className="web-login__lock"><LockKeyhole size={22} /></div>
          <span className="web-eyebrow">安全登录</span>
          <h2>欢迎回来</h2>
          <p>使用管理员分配的团队账号进入工作空间。</p>
          <label>
            <span>邮箱</span>
            <input
              autoComplete="email"
              inputMode="email"
              placeholder="name@company.com"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            <span>密码</span>
            <input
              autoComplete="current-password"
              placeholder="请输入密码"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {notice && <div className="web-login__notice">{notice}</div>}
          <button disabled={loading} type="submit">
            {loading ? <LoaderCircle className="spin" size={18} /> : <LockKeyhole size={18} />}
            {loading ? "正在验证" : "进入运营工作台"}
          </button>
          <small>连续登录失败会被临时限流，请勿共享账号。</small>
        </form>
      </section>
    </main>
  );
}

function StoreStatus({ value }) {
  const normalized =
    value === "active"
      ? "正常"
      : value === "reauthorization_required"
        ? "需重新授权"
        : "已停用";
  return <span className={`web-status web-status--${value || "unknown"}`}>{normalized}</span>;
}

function isAuthorizedSheinStore(store) {
  return Boolean(String(store?.supplierId || "").trim());
}

function StoreAuthorizationPanel({ session, stores, onStoresReload }) {
  const [busy, setBusy] = useState(false);
  const [editingStoreId, setEditingStoreId] = useState("");
  const [storeLabel, setStoreLabel] = useState("");
  const [savingStoreId, setSavingStoreId] = useState("");
  const [notice, setNotice] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sheinAuthorized")) {
      return {
        type: "success",
        text: `${params.get("storeLabel") || "SHEIN 店铺"}授权成功`,
      };
    }
    if (params.get("sheinAuthError")) {
      return { type: "error", text: params.get("sheinAuthError") };
    }
    return null;
  });
  const canSeeAll = ["owner", "admin"].includes(session.user.role);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("sheinAuthorized") && !params.has("sheinAuthError")) return;
    params.delete("sheinAuthorized");
    params.delete("sheinAuthError");
    params.delete("storeLabel");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  const startAuthorization = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await requestWebApi("/v1/web/shein/auth/start", {
        method: "POST",
        body: "{}",
      });
      if (!result.authorizationUrl) {
        throw new Error("授权服务未返回SHEIN地址");
      }
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setNotice({ type: "error", text: error.message });
      setBusy(false);
    }
  };

  const saveStoreLabel = async (store) => {
    const label = storeLabel.trim();
    if (!label) {
      setNotice({ type: "error", text: "请输入店铺名称" });
      return;
    }
    setSavingStoreId(store.id);
    setNotice(null);
    try {
      await requestWebApi(`/v1/web/stores/${encodeURIComponent(store.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ label }),
      });
      await onStoresReload();
      setEditingStoreId("");
      setNotice({ type: "success", text: `店铺已命名为“${label}”` });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setSavingStoreId("");
    }
  };

  return (
    <div className="web-content web-store-auth">
      <section className="web-store-auth__hero">
        <div>
          <span className="web-eyebrow">SHEIN OPEN PLATFORM</span>
          <h2>授权店铺</h2>
          <p>
            {canSeeAll
              ? "管理员可查看当前工作空间所有成员授权的店铺。"
              : "你只能查看和使用自己授权的店铺。"}
          </p>
        </div>
        <button disabled={busy} onClick={startAuthorization} type="button">
          {busy ? <LoaderCircle className="spin" size={18} /> : <Link2 size={18} />}
          {busy ? "正在打开SHEIN" : "授权新店铺"}
        </button>
      </section>

      {notice && (
        <div className={`web-store-auth__notice is-${notice.type}`} role="status">
          {notice.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{notice.text}</span>
        </div>
      )}

      <section className="web-card web-card--stores">
        <div className="web-card__head">
          <div>
            <span className="web-eyebrow">权限内的店铺</span>
            <h3>{canSeeAll ? "全部成员授权店铺" : "我授权的店铺"}</h3>
          </div>
          <button className="web-store-auth__refresh" onClick={onStoresReload} type="button">
            <RefreshCw size={16} />
            刷新
          </button>
        </div>
        {stores.length ? (
          <div className="web-store-auth__list">
            {stores.map((store) => (
              <article key={store.id}>
                <span className="web-store-list__mark">
                  {(store.label || "SH").replace(/\s+/g, "").slice(0, 2)}
                </span>
                <div>
                  {editingStoreId === store.id ? (
                    <form
                      className="web-store-auth__rename"
                      onSubmit={(event) => { event.preventDefault(); saveStoreLabel(store); }}
                    >
                      <input
                        autoFocus
                        maxLength={40}
                        onChange={(event) => setStoreLabel(event.target.value)}
                        value={storeLabel}
                      />
                      <button disabled={savingStoreId === store.id} type="submit">
                        {savingStoreId === store.id ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />}
                        保存
                      </button>
                      <button onClick={() => setEditingStoreId("")} type="button"><X size={14} /></button>
                    </form>
                  ) : (
                    <strong className="web-store-auth__name">
                      {store.label || `SHEIN 店铺 ${store.supplierId || ""}`}
                      <button
                        aria-label="修改店铺名称"
                        onClick={() => {
                          setEditingStoreId(store.id);
                          setStoreLabel(store.label || `SHEIN 店铺 ${store.supplierId || ""}`);
                        }}
                        type="button"
                      ><Pencil size={13} /></button>
                    </strong>
                  )}
                  <small>
                    Supplier ID {store.supplierId || "待获取"} · {store.businessMode || "全托管"}
                  </small>
                  {canSeeAll && store.authorizedBy && (
                    <small>
                      授权成员：{store.authorizedBy.displayName || store.authorizedBy.email}
                    </small>
                  )}
                </div>
                <div className="web-store-auth__meta">
                  <StoreStatus value={store.status} />
                  <small>
                    {store.authorizedAt
                      ? new Date(store.authorizedAt).toLocaleString("zh-CN", { hour12: false })
                      : "授权时间待同步"}
                  </small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="web-empty">
            <Store size={28} />
            <strong>还没有可访问的SHEIN店铺</strong>
            <small>点击“授权新店铺”进入SHEIN官方授权页。</small>
          </div>
        )}
      </section>
    </div>
  );
}

function getWebPublishStandard(info = {}) {
  if (Array.isArray(info?.data)) return info.data[0] || {};
  if (info?.data && typeof info.data === "object") return info.data;
  return info && typeof info === "object" ? info : {};
}

function isWebRuleRequired(config, fallback = true) {
  if (!config || config.is_required === undefined || config.is_required === null) {
    return fallback;
  }
  if (typeof config.is_required === "boolean") return config.is_required;
  return ["1", "true", "yes", "required", "是"].includes(
    String(config.is_required).trim().toLowerCase(),
  );
}

function createWebSkuRow({
  supplierCode = "",
  index = 0,
  source = {},
} = {}) {
  return {
    ...createSizeRow(),
    supplierSku: supplierCode
      ? `${supplierCode}-${String(index + 1).padStart(2, "0")}`
      : "",
    costPrice: "",
    inventoryNum: "0",
    mallState: "1",
    stopPurchase: "1",
    quantity: "1",
    imageAssetId: "",
    sizeChartHeightCm: "",
    ...source,
  };
}

const publishBatchStateLabels = {
  queued: "等待预检",
  preflighting: "预检中",
  ready: "预检通过",
  paused: "已暂停",
  failed: "预检失败",
  completed: "已完成",
};

const publishTemplateTypes = [
  { id: "attribute", label: "商品属性", description: "按末级类目保存动态商品属性" },
  { id: "size", label: "颜色与尺寸", description: "只保存颜色、尺寸、长和宽" },
  { id: "packaging", label: "打包体积", description: "严格解析标准工作簿" },
  { id: "tail_image", label: "尾部主图", description: "只追加到主图最后" },
  { id: "compliance", label: "店铺合规", description: "欧代、制造商等仅限当前店铺" },
];

function CategoryColumnsPicker({ tree = [], value, onChange }) {
  const [selectedIds, setSelectedIds] = useState([]);
  useEffect(() => {
    if (!value) setSelectedIds([]);
  }, [value]);
  const columns = [];
  let nodes = tree;
  let depth = 0;
  while (Array.isArray(nodes) && nodes.length) {
    columns.push(nodes);
    const selected = nodes.find(
      (node) => String(node.category_id) === String(selectedIds[depth] || ""),
    );
    nodes = selected?.children || [];
    depth += 1;
  }
  const choose = (node, columnIndex) => {
    const nextIds = [...selectedIds.slice(0, columnIndex), String(node.category_id)];
    setSelectedIds(nextIds);
    if (node.last_category) {
      const path = nextIds.map((id, index) => {
        let branch = tree;
        let match = null;
        for (let level = 0; level <= index; level += 1) {
          match = branch.find((item) => String(item.category_id) === String(nextIds[level]));
          branch = match?.children || [];
        }
        return match?.category_name || id;
      });
      onChange({
        categoryId: String(node.category_id),
        productTypeId: String(node.product_type_id),
        name: node.category_name,
        path,
      });
    } else {
      onChange(null);
    }
  };
  return (
    <div className="publish-category-picker">
      <header><strong>从左至右选择末级类目</strong><small>{value?.path?.join(" / ") || "尚未选到末级类目"}</small></header>
      <div className="publish-category-picker__columns">
        {columns.map((items, columnIndex) => (
          <div key={`category-column-${columnIndex}`}>
            {items.map((node) => (
              <button
                className={String(selectedIds[columnIndex]) === String(node.category_id) ? "is-active" : ""}
                key={node.category_id}
                onClick={() => choose(node, columnIndex)}
                type="button"
              >
                <span>{node.category_name}</span><ChevronDown size={14} />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmedOptionPicker({
  options = [],
  valueIds = [],
  multiple = false,
  maxSelections = 0,
  placeholder = "请选择",
  onConfirm,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(valueIds.map(String));
  const normalizedValues = valueIds.map(String);
  const selectedLabels = options
    .filter((option) => normalizedValues.includes(String(option.id)))
    .map((option) => option.label);
  const visibleOptions = options
    .filter((option) => String(option.label || "").toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 160);

  const toggle = (id) => {
    const value = String(id);
    setDraft((current) => {
      if (!multiple) return [value];
      if (current.includes(value)) return current.filter((item) => item !== value);
      const limit = Number(maxSelections) || Infinity;
      return current.length >= limit ? current : [...current, value];
    });
  };

  const begin = () => {
    setDraft(normalizedValues);
    setQuery("");
    setOpen(true);
  };

  return (
    <div className={`confirmed-option-picker${open ? " is-open" : ""}`}>
      <button className="confirmed-option-picker__trigger" onClick={begin} type="button">
        <span className={selectedLabels.length ? "" : "is-placeholder"}>
          {selectedLabels.length ? selectedLabels.join("、") : placeholder}
        </span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="confirmed-option-picker__panel">
          <header>
            <div><strong>{multiple ? "选择属性值" : "选择一个属性值"}</strong><small>{multiple && maxSelections ? `最多选择${maxSelections}项` : "仅保存SHEIN当前返回的真实值"}</small></div>
            <button aria-label="关闭" onClick={() => setOpen(false)} type="button"><X size={16} /></button>
          </header>
          {options.length > 8 && (
            <label className="confirmed-option-picker__search">
              <Search size={15} />
              <input autoFocus placeholder="搜索属性值" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          )}
          <div className="confirmed-option-picker__options">
            {visibleOptions.map((option) => {
              const selected = draft.includes(String(option.id));
              return (
                <button className={selected ? "is-selected" : ""} key={option.id} onClick={() => toggle(option.id)} type="button">
                  <span className="confirmed-option-picker__check">{selected && <CheckCircle2 size={15} />}</span>
                  <span>{option.label}</span>
                </button>
              );
            })}
            {!visibleOptions.length && <div className="confirmed-option-picker__empty">没有匹配的SHEIN属性值</div>}
          </div>
          <footer>
            <button className="web-secondary-button" onClick={() => setOpen(false)} type="button">取消</button>
            <button className="web-primary-button" disabled={!draft.length} onClick={() => { onConfirm(draft); setOpen(false); }} type="button"><CheckCircle2 size={15} />确定</button>
          </footer>
        </div>
      )}
    </div>
  );
}

function AttributeValueEditor({ field, value = {}, onChange }) {
  const assignment = value && typeof value === "object"
    ? value
    : { valueIds: value ? [String(value)] : [], customValue: "" };
  const valueIds = Array.isArray(assignment.valueIds)
    ? assignment.valueIds.map(String)
    : [];
  const mode = Number(field.modeCode);
  const allowsPreset = [1, 2, 3, 4].includes(mode) && field.values.length > 0;
  const allowsMultiple = [1, 4].includes(mode);
  const allowsManual = [0, 4].includes(mode);
  return (
    <>
      {allowsPreset && (
        <ConfirmedOptionPicker
          maxSelections={field.maxSelections}
          multiple={allowsMultiple}
          onConfirm={(selected) => onChange({ ...assignment, valueIds: selected })}
          options={field.values}
          placeholder="请选择SHEIN属性值"
          valueIds={valueIds}
        />
      )}
      {allowsManual && (
        <input
          placeholder={mode === 4 ? "可补充自定义值" : "按SHEIN要求输入"}
          value={assignment.customValue || ""}
          onChange={(event) => onChange({
            ...assignment,
            customValue: event.target.value,
          })}
        />
      )}
      <small>{field.mode}{allowsMultiple && field.maxSelections ? ` · 最多${field.maxSelections}项` : ""}</small>
    </>
  );
}

function AttributeTemplateFields({
  fields,
  values,
  onChange,
  optional = false,
  invalidFieldIds = new Set(),
}) {
  if (!fields.length) return null;
  return (
    <section className={`publish-attribute-group${optional ? " is-optional" : " is-required"}`}>
      <header>
        <div>
          <strong>{optional ? "选填属性" : "必填属性"}</strong>
          <small>{optional ? "按商品实际情况补充" : "保存模板前必须完整填写"}</small>
        </div>
        <span>{fields.length}项</span>
      </header>
      <div className="publish-dynamic-fields">
        {fields.map((field) => (
          <label
            className={invalidFieldIds.has(String(field.id)) ? "is-invalid" : ""}
            id={`publish-template-attribute-${field.id}`}
            key={field.id}
          >
            <span>{field.required && <b>*</b>}{field.name}<small>ID {field.id} · {field.status}</small></span>
            <AttributeValueEditor
              field={field}
              value={values[String(field.id)]}
              onChange={(value) => onChange(String(field.id), value)}
            />
            {invalidFieldIds.has(String(field.id)) && (
              <em className="publish-field-error">此项为SHEIN必填属性，保存前请完成选择</em>
            )}
          </label>
        ))}
      </div>
    </section>
  );
}

function TailImageCropDialog({ item, onCancel, onSave }) {
  const [presetId, setPresetId] = useState(item?.presetId || "portrait");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [cropPixels, setCropPixels] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setPresetId(item?.presetId || "portrait");
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCropPixels(null);
    setError("");
  }, [item?.id]);

  if (!item) return null;
  const preset = SHEIN_MAIN_IMAGE_PRESETS[presetId];

  const confirm = async () => {
    if (!cropPixels) return;
    setSaving(true);
    setError("");
    try {
      const file = await cropImageFile({
        file: item.file,
        imageUrl: item.url,
        cropPixels,
        presetId,
      });
      await onSave(file);
    } catch (caught) {
      setError(caught.message || "裁剪结果上传失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="publish-crop-dialog" role="dialog" aria-modal="true" aria-label="裁剪尾部主图">
      <div className="publish-crop-dialog__panel">
        <header>
          <div><span className="web-eyebrow">SHEIN 主图规范</span><h3>裁剪图片</h3><small>{item.file.name}</small></div>
          <button aria-label="取消裁剪" disabled={saving} onClick={onCancel} type="button"><X size={18} /></button>
        </header>
        <div className="publish-crop-dialog__presets">
          {Object.values(SHEIN_MAIN_IMAGE_PRESETS).map((option) => (
            <button className={presetId === option.id ? "is-active" : ""} key={option.id} onClick={() => setPresetId(option.id)} type="button">
              <strong>{option.label}</strong>
              <small>{option.id === "portrait" ? "平台固定像素" : "输出 1200×1200"}</small>
            </button>
          ))}
        </div>
        <div className="publish-crop-dialog__canvas">
          <Cropper
            aspect={preset.aspect}
            crop={crop}
            image={item.url}
            onCropChange={setCrop}
            onCropComplete={(_, pixels) => setCropPixels(pixels)}
            onZoomChange={setZoom}
            showGrid
            zoom={zoom}
          />
        </div>
        <label className="publish-crop-dialog__zoom">
          <span>缩放</span>
          <input max="3" min="1" onChange={(event) => setZoom(Number(event.target.value))} step="0.01" type="range" value={zoom} />
        </label>
        {error && <div className="publish-crop-dialog__error"><AlertCircle size={15} />{error}</div>}
        <footer>
          <small>裁剪在当前浏览器完成，保存后才上传，不占服务器图片处理资源。</small>
          <div>
            <button className="web-secondary-button" disabled={saving} onClick={onCancel} type="button">取消</button>
            <button className="web-primary-button" disabled={saving || !cropPixels} onClick={confirm} type="button">
              {saving ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
              {saving ? "正在裁剪并上传" : "保存裁剪"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function PublishTemplateCenter({ session, store }) {
  const [type, setType] = useState("attribute");
  const [templates, setTemplates] = useState([]);
  const [categoryTree, setCategoryTree] = useState([]);
  const [category, setCategory] = useState(null);
  const [schema, setSchema] = useState(null);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [attributeValues, setAttributeValues] = useState({});
  const [sizeColorText, setSizeColorText] = useState("");
  const [sizeRows, setSizeRows] = useState([{
    sizeText: "", lengthCm: "", widthCm: "",
  }]);
  const [packaging, setPackaging] = useState(null);
  const [assets, setAssets] = useState([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState([]);
  const [referenceSkc, setReferenceSkc] = useState("");
  const [complianceBundle, setComplianceBundle] = useState(null);
  const [selectedAgencyId, setSelectedAgencyId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [feedback, setFeedback] = useState(null);
  const [tailUploading, setTailUploading] = useState(false);
  const [tailCropQueue, setTailCropQueue] = useState([]);
  const [assetPreviewUrls, setAssetPreviewUrls] = useState({});
  const [saveAttempted, setSaveAttempted] = useState(false);

  const showFeedback = (message, kind = "success") => {
    setFeedback({ id: Date.now(), message, kind });
  };

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 4200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const loadTemplates = async () => {
    if (!store?.id) return;
    const result = await requestWebApi(
      `/v1/web/stores/${encodeURIComponent(store.id)}/publish-templates`,
    );
    setTemplates(result.templates || []);
  };

  useEffect(() => {
    if (!store?.id) return;
    setNotice("");
    loadTemplates().catch((error) => setNotice(error.message));
  }, [store?.id]);

  useEffect(() => {
    if (type !== "tail_image") return;
    const missing = assets.filter((asset) =>
      asset?.id && asset?.storeId && !assetPreviewUrls[asset.id],
    );
    if (!missing.length) return;
    let cancelled = false;
    Promise.allSettled(missing.map(async (asset) => {
      const ticket = await requestWebApi(asset.templateId
        ? `/v1/web/stores/${encodeURIComponent(store.id)}/publish-templates/${encodeURIComponent(asset.templateId)}/media/${encodeURIComponent(asset.id)}/download-ticket`
        : `/v1/web/stores/${encodeURIComponent(asset.storeId)}/media/${encodeURIComponent(asset.id)}/download-ticket`);
      return [asset.id, ticket.download?.url || ""];
    })).then((results) => {
      if (cancelled) return;
      const resolved = Object.fromEntries(results.flatMap((result) =>
        result.status === "fulfilled" && result.value[1] ? [result.value] : [],
      ));
      if (Object.keys(resolved).length) {
        setAssetPreviewUrls((current) => ({ ...current, ...resolved }));
      }
    });
    return () => { cancelled = true; };
  }, [assets, assetPreviewUrls, type]);

  useEffect(() => {
    if (!store?.id || type !== "attribute" || categoryTree.length) return;
    const key = `categories:${store.id}`;
    setSchemaLoading(true);
    cachedClientRequest(
      publishCategoryClientCache,
      key,
      () => requestWebApi(`/v1/web/stores/${encodeURIComponent(store.id)}/publish/categories`),
    )
      .then((result) => setCategoryTree(result.info?.data || []))
      .catch((error) => setNotice(error.message))
      .finally(() => setSchemaLoading(false));
  }, [categoryTree.length, store?.id, type]);

  useEffect(() => {
    if (!category?.categoryId || !category?.productTypeId) {
      setSchema(null);
      return;
    }
    const key = `schema:${store.id}:${category.categoryId}:${category.productTypeId}`;
    setSchemaLoading(true);
    cachedClientRequest(
      publishSchemaClientCache,
      key,
      () => requestWebApi(`/v1/web/stores/${encodeURIComponent(store.id)}/publish/schema`, {
        method: "POST",
        body: JSON.stringify(category),
      }),
    )
      .then(setSchema)
      .catch((error) => setNotice(error.message))
      .finally(() => setSchemaLoading(false));
  }, [category?.categoryId, category?.productTypeId, store?.id]);

  const fields = schema ? buildAttributeFields(schema.attributes, category?.productTypeId) : [];
  const productFields = fields
    .filter((field) => [3, 4].includes(field.typeCode))
    .sort((left, right) => Number(right.required) - Number(left.required));
  const requiredProductFields = productFields.filter((field) => field.required);
  const optionalProductFields = productFields.filter((field) => !field.required);
  const visibleTemplates = templates.filter((template) => template.templateType === type);
  const agencies = complianceBundle?.bundle?.bindableAgencies || [];
  const missingRequiredAttributeIds = new Set(
    saveAttempted
      ? requiredProductFields
          .filter((field) => {
            const assignment = attributeValues[String(field.id)] || {};
            return !(assignment.valueIds || []).length &&
              !String(assignment.customValue || "").trim();
          })
          .map((field) => String(field.id))
      : [],
  );

  const reset = (nextType = type) => {
    setType(nextType);
    setName("");
    setEditingId("");
    setCategory(null);
    setSchema(null);
    setAttributeValues({});
    setSizeColorText("");
    setSizeRows([{ sizeText: "", lengthCm: "", widthCm: "" }]);
    setPackaging(null);
    setAssets([]);
    setSelectedAssetIds([]);
    setAssetPreviewUrls({});
    setTailCropQueue([]);
    setReferenceSkc("");
    setComplianceBundle(null);
    setSelectedAgencyId("");
    setNotice("");
    setSaveAttempted(false);
  };

  const edit = (template) => {
    if (!template.canManage) {
      setNotice(`“${template.name}”是${template.scopeLabel}模板，可直接引用，但只有创建者或管理员可以修改`);
      return;
    }
    setType(template.templateType);
    setEditingId(template.id);
    setName(template.name);
    setCategory(template.categoryId ? {
      categoryId: template.categoryId,
      productTypeId: template.productTypeId,
      name: template.data?.categoryName || template.categoryId,
      path: template.data?.categoryPath || [template.categoryId],
    } : null);
    setAttributeValues(Object.fromEntries((template.data?.assignments || []).map((item) => [
      String(item.attributeId),
      { valueIds: item.valueIds || [], customValue: item.customValue || "" },
    ])));
    setSizeColorText(template.data?.colorText || template.data?.rows?.[0]?.colorLabel || "");
    setSizeRows(template.data?.rows?.length
      ? template.data.rows.map((row) => ({
          sizeText: row.sizeText || row.sizeLabel || "",
          lengthCm: row.lengthCm || "",
          widthCm: row.widthCm || "",
        }))
      : [{ sizeText: "", lengthCm: "", widthCm: "" }]);
    setPackaging(template.templateType === "packaging" ? template.data : null);
    setSelectedAssetIds(template.data?.assetIds || []);
    if (template.templateType === "tail_image") {
      const metadata = Array.isArray(template.data?.assets)
        ? template.data.assets
        : (template.data?.assetIds || []).map((id) => ({
            id,
            originalName: `尾部主图 ${String(id).slice(0, 8)}`,
            contentType: "image/jpeg",
            storeId: template.storeId,
          }));
      setAssets(metadata.map((asset) => ({
        ...asset,
        storeId: asset.storeId || template.storeId,
        templateId: template.id,
      })));
    }
    setReferenceSkc(template.data?.referenceSkc || "");
    setSelectedAgencyId(template.data?.agencyId || "");
    setNotice(`正在编辑“${template.name}”`);
  };

  const parsePackaging = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setNotice("只允许上传.xlsx标准工作簿");
      return;
    }
    setBusy(true);
    try {
      const { default: readExcelFile } = await import("read-excel-file/browser");
      const normalized = normalizePackagingWorkbook(await readExcelFile(file));
      if (normalized.issues.length || !normalized.materialCount) {
        throw new Error(normalized.issues[0] || "工作簿没有可用材质");
      }
      setPackaging({ fileName: file.name, importedAt: new Date().toISOString(), ...normalized });
      setNotice(`解析完成：${normalized.materialCount}种材质、${normalized.sizeCount}个尺寸、${normalized.rowCount}条记录${normalized.overwrittenCount ? `；${normalized.overwrittenCount}条重复尺寸已按表格最后一行覆盖` : ""}`);
    } catch (error) {
      setPackaging(null);
      setNotice(`解析失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  };

  const uploadTailFile = async (file, previewUrl = "", dimensions = {}) => {
    const asset = await uploadWebMediaFile({
      storeId: store.id,
      file,
      purpose: "selected_unpublished",
    });
    const normalized = { ...asset, ...dimensions, storeId: store.id };
    setAssets((current) => [normalized, ...current.filter((item) => item.id !== asset.id)]);
    setSelectedAssetIds((current) => current.includes(asset.id) ? current : [...current, asset.id]);
    if (previewUrl) {
      setAssetPreviewUrls((current) => ({ ...current, [asset.id]: previewUrl }));
    }
    return normalized;
  };

  const uploadTailImages = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setTailUploading(true);
    let uploadedCount = 0;
    const cropItems = [];
    const errors = [];
    for (const file of files) {
      try {
        if (!/^image\/(jpeg|png)$/i.test(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) {
          throw new Error(`${file.name}：SHEIN主图仅接受JPG/JPEG/PNG`);
        }
        const prepared = await prepareWebImageFile(file);
        const { width, height } = await readImageDimensions(prepared);
        const previewUrl = URL.createObjectURL(prepared);
        if (isSheinMainImageReady({ width, height, sizeBytes: prepared.size })) {
          await uploadTailFile(prepared, previewUrl, { width, height });
          uploadedCount += 1;
        } else {
          cropItems.push({
            id: `${Date.now()}-${cropItems.length}-${prepared.name}`,
            file: prepared,
            url: previewUrl,
            presetId: width === height ? "square" : "portrait",
          });
        }
      } catch (error) {
        errors.push(error.message);
      }
    }
    setTailCropQueue((current) => [...current, ...cropItems]);
    setTailUploading(false);
    if (errors.length) setNotice(errors.join("；"));
    else if (cropItems.length) {
      setNotice(`${uploadedCount}张已直接上传，${cropItems.length}张需要按SHEIN比例裁剪`);
    } else {
      showFeedback(`已上传并选中${uploadedCount}张尾部主图`);
    }
  };

  const saveCroppedTailImage = async (file) => {
    const current = tailCropQueue[0];
    const previewUrl = URL.createObjectURL(file);
    try {
      const dimensions = await readImageDimensions(file);
      await uploadTailFile(file, previewUrl, dimensions);
      if (current?.url) URL.revokeObjectURL(current.url);
      setTailCropQueue((queue) => queue.slice(1));
      showFeedback(`“${current?.file?.name || file.name}”已裁剪并上传`);
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setNotice(`裁剪结果上传失败：${error.message}`);
      throw error;
    }
  };

  const cancelTailCrop = () => {
    const current = tailCropQueue[0];
    if (current?.url) URL.revokeObjectURL(current.url);
    setTailCropQueue((queue) => queue.slice(1));
  };

  const removeTailAsset = (assetId) => {
    const asset = assets.find((item) => String(item.id) === String(assetId));
    setAssets((current) => current.filter((item) => String(item.id) !== String(assetId)));
    setSelectedAssetIds((current) => current.filter((id) => String(id) !== String(assetId)));
    const preview = assetPreviewUrls[assetId];
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    setAssetPreviewUrls((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    if (asset?.originalName) showFeedback(`已从模板中移除“${asset.originalName}”`);
  };

  const syncCompliance = async () => {
    if (!referenceSkc.trim()) return setNotice("请输入当前店铺的参照SKC");
    setBusy(true);
    try {
      const result = await requestWebApi(`/v1/web/stores/${encodeURIComponent(store.id)}/compliance/rules`, {
        method: "POST",
        body: JSON.stringify({ skc: referenceSkc.trim() }),
      });
      setComplianceBundle(result);
      setNotice(`已从当前店铺读取${result.bundle?.bindableAgencies?.length || 0}个可绑定公司/代理记录`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setSaveAttempted(true);
    if (!name.trim()) return setNotice("请填写模板名称");
    let data = {};
    let schemaSnapshot = {};
    if (type === "attribute") {
      if (!schema) return setNotice("请先选择类目并读取SHEIN属性结构");
      const missing = productFields.filter((field) => {
        if (!field.required) return false;
        const assignment = attributeValues[String(field.id)] || {};
        return !(assignment.valueIds || []).length &&
          !String(assignment.customValue || "").trim();
      });
      if (missing.length) {
        setNotice(`保存前请补齐：${missing.map((field) => field.name).join("、")}`);
        window.requestAnimationFrame(() => {
          document.getElementById(`publish-template-attribute-${missing[0].id}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
      const assignments = productFields.flatMap((field) => {
        const assignment = attributeValues[String(field.id)] || {};
        const valueIds = Array.isArray(assignment.valueIds)
          ? assignment.valueIds.map(String).filter(Boolean)
          : [];
        const customValue = String(assignment.customValue || "").trim();
        if (!valueIds.length && !customValue) return [];
        return [{
          attributeId: String(field.id),
          valueIds,
          customValue,
        }];
      });
      setBusy(true);
      try {
        const linked = await requestWebApi(
          `/v1/web/stores/${encodeURIComponent(store.id)}/publish/associated-rules`,
          {
            method: "POST",
            body: JSON.stringify({
              categoryId: category.categoryId,
              productTypeId: category.productTypeId,
              attributeList: assignments.flatMap((item) =>
                item.valueIds.length
                  ? item.valueIds.map((valueId) => ({
                      attributeId: item.attributeId,
                      attributeValueId: valueId,
                    }))
                  : [{ attributeId: item.attributeId }],
              ),
            }),
          },
        );
        const linkedRules = linked.info?.data?.[0]?.link_rule_attribute_list || [];
        const productFieldIds = new Set(productFields.map((field) => String(field.id)));
        const linkedMissing = linkedRules.filter((rule) => {
          if (!productFieldIds.has(String(rule.attribute_id))) return false;
          const assignment = assignments.find(
            (item) => String(item.attributeId) === String(rule.attribute_id),
          );
          if (!assignment) return true;
          const allowed = [
            ...(rule.attribute_value_list || []),
            ...(rule.attribute_value_pre_fill_list || []),
          ].map(String);
          return allowed.length > 0 &&
            !assignment.valueIds.some((valueId) => allowed.includes(String(valueId)));
        });
        if (linkedMissing.length) {
          const names = linkedMissing.map((rule) =>
            productFields.find((field) => String(field.id) === String(rule.attribute_id))?.name || rule.attribute_id,
          );
          setNotice(`SHEIN关联规则要求继续补充：${names.join("、")}`);
          setBusy(false);
          return;
        }
        const ruleAttributeIds = [...new Set(linkedRules.map((rule) =>
          String(rule.attribute_id || "")).filter(Boolean))];
        data = {
          categoryName: category.name,
          categoryPath: category.path,
          schemaFetchedAt: new Date().toISOString(),
          assignments,
          associatedRuleCheck: {
            checkedAt: new Date().toISOString(),
            attributeIds: ruleAttributeIds,
          },
        };
      } catch (error) {
        setNotice(`关联属性校验失败：${error.message}`);
        setBusy(false);
        return;
      }
      const selectedByField = new Map(assignments.map((item) => [
        String(item.attributeId),
        new Set(item.valueIds || []),
      ]));
      schemaSnapshot = {
        category: {
          categoryId: category.categoryId,
          productTypeId: category.productTypeId,
        },
        fields: productFields.map((field) => ({
          id: String(field.id),
          name: field.name,
          typeCode: field.typeCode,
          modeCode: field.modeCode,
          required: Boolean(field.required),
          maxSelections: Number(field.maxSelections || 0),
          values: (field.values || []).filter((value) =>
            selectedByField.get(String(field.id))?.has(String(value.id)),
          ).map((value) => ({ id: String(value.id), label: value.label })),
        })),
      };
    } else if (type === "size") {
      if (!sizeColorText.trim()) return setNotice("请填写这套尺寸模板共用的颜色");
      const incomplete = sizeRows.findIndex((row) =>
        !String(row.sizeText || "").trim() || !(Number(row.lengthCm) > 0) || !(Number(row.widthCm) > 0),
      );
      if (incomplete >= 0) return setNotice(`请补齐第${incomplete + 1}行的自定义尺寸、长和宽`);
      data = {
        colorText: sizeColorText.trim(),
        matchingPolicy: "match_current_shein_schema_on_publish",
        rows: sizeRows.map((row) => ({
          sizeText: String(row.sizeText).trim(),
          lengthCm: Number(row.lengthCm),
          widthCm: Number(row.widthCm),
        })),
      };
    } else if (type === "packaging") {
      if (!packaging) return setNotice("请上传并通过严格校验的标准工作簿");
      data = packaging;
    } else if (type === "tail_image") {
      if (!selectedAssetIds.length) return setNotice("请至少选择一张主图尾图");
      data = {
        assetIds: selectedAssetIds,
        placement: "append",
        assets: selectedAssetIds.map((id) => {
          const asset = assets.find((item) => String(item.id) === String(id)) || {};
          return {
            id,
            originalName: asset.originalName || `尾部主图 ${String(id).slice(0, 8)}`,
            contentType: asset.contentType || "image/jpeg",
            width: asset.width || null,
            height: asset.height || null,
            storeId: asset.storeId || store.id,
          };
        }),
      };
    } else {
      if (!complianceBundle) return setNotice("请先从当前店铺同步合规公司信息");
      const agency = agencies.find((item) => String(item.agencyId) === String(selectedAgencyId));
      data = {
        referenceSkc: referenceSkc.trim(),
        agencyId: agency?.agencyId || "",
        agencyName: agency?.agencyName || "",
        agencyType: agency?.agencyType,
        agencySubType: agency?.agencySubType,
        platformStatus: agency?.agencyStatus,
        syncedAt: new Date().toISOString(),
        storeScoped: true,
      };
    }
    setBusy(true);
    setSaveState("saving");
    try {
      const result = await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/publish-templates${editingId ? `/${encodeURIComponent(editingId)}` : ""}`,
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({
            templateType: type,
            name: name.trim(),
            categoryId: category?.categoryId || "",
            productTypeId: category?.productTypeId || "",
            schemaSnapshot,
            data,
          }),
        },
      );
      await loadTemplates();
      setEditingId(result.template.id);
      setSaveState("saved");
      setNotice("");
      showFeedback(`模板“${result.template.name}”保存成功`);
      window.setTimeout(() => setSaveState("idle"), 1800);
    } catch (error) {
      setNotice(error.message);
      setSaveState("error");
      showFeedback(`保存失败：${error.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (template) => {
    if (!window.confirm(`确认删除模板“${template.name}”吗？`)) return;
    setBusy(true);
    try {
      await requestWebApi(`/v1/web/stores/${encodeURIComponent(store.id)}/publish-templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
      await loadTemplates();
      if (editingId === template.id) reset(type);
      setNotice(`模板“${template.name}”已删除`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (!store) return <div className="web-content"><div className="web-empty"><Store size={26} /><strong>请先授权店铺</strong><small>模板严格按店铺隔离。</small></div></div>;

  return (
    <div className="web-content publish-template-center">
      <section className="publish-template-toolbar">
        <nav className="publish-template-tabs">
          {publishTemplateTypes.map((item) => <button className={type === item.id ? "is-active" : ""} key={item.id} onClick={() => reset(item.id)} type="button"><strong>{item.label}</strong><small>{item.description}</small></button>)}
        </nav>
        <button className="web-secondary-button" onClick={() => reset(type)} type="button"><Plus size={16} />新建当前模板</button>
      </section>
      {notice && <div className="web-alert"><AlertCircle size={17} /><span>{notice}</span></div>}
      <div className="publish-template-layout">
        <section className="publish-template-editor">
          <header><div><span className="web-eyebrow">{editingId ? "编辑模板" : "新建模板"}</span><h3>{publishTemplateTypes.find((item) => item.id === type)?.label}</h3></div><span className="publish-template-scope">{type === "compliance" ? "当前店铺" : ["owner", "admin"].includes(session?.user?.role) ? "全员通用" : "我的店铺通用"}</span></header>
          <label className="publish-template-name"><span>模板名称</span><input maxLength="80" placeholder="输入便于团队识别的名称" value={name} onChange={(event) => setName(event.target.value)} /></label>
          {type === "attribute" && <CategoryColumnsPicker tree={categoryTree} value={category} onChange={setCategory} />}
          {type === "attribute" && schemaLoading && <div className="publish-inline-loading"><LoaderCircle className="spin" size={16} />正在读取SHEIN类目规则</div>}
          {type === "attribute" && schema && (
            <div className="publish-attribute-groups">
              <AttributeTemplateFields
                fields={requiredProductFields}
                invalidFieldIds={missingRequiredAttributeIds}
                values={attributeValues}
                onChange={(fieldId, value) => setAttributeValues((current) => ({ ...current, [fieldId]: value }))}
              />
              <AttributeTemplateFields
                fields={optionalProductFields}
                onChange={(fieldId, value) => setAttributeValues((current) => ({ ...current, [fieldId]: value }))}
                optional
                values={attributeValues}
              />
            </div>
          )}
          {type === "size" && (
            <div className="publish-size-template">
              <div className="publish-size-template__intro">
                <div><strong>颜色（整套模板共用）</strong><small>每个商品只保存一个颜色，不再重复到每个SKU。</small></div>
                <input maxLength="80" placeholder="例如：多色、米白色" value={sizeColorText} onChange={(event) => setSizeColorText(event.target.value)} />
              </div>
              <div className="publish-size-template__tip"><AlertCircle size={15} /><span>这里保存你输入的颜色和尺寸文本；引用到商品后，再按当前类目弹出SHEIN真实选项供匹配确认。</span></div>
              <div className="publish-size-template__head"><span>自定义尺寸</span><span>长(cm)</span><span>宽(cm)</span><span /></div>
              {sizeRows.map((row, index) => (
                <div className="publish-size-template__row" key={`size-row-${index}`}>
                  <input
                    placeholder="例如：40*60、直径140"
                    value={row.sizeText}
                    onChange={(event) => {
                      const sizeText = event.target.value;
                      const parsed = parseSheinSizeLabel(sizeText, /直径|round/i.test(sizeText) ? "round" : "rectangle");
                      setSizeRows((current) => current.map((item, i) => i === index ? {
                        ...item,
                        sizeText,
                        lengthCm: parsed?.lengthCm || item.lengthCm,
                        widthCm: parsed?.widthCm || item.widthCm,
                      } : item));
                    }}
                  />
                  <input aria-label="长" inputMode="decimal" value={row.lengthCm} onChange={(event) => setSizeRows((current) => current.map((item, i) => i === index ? { ...item, lengthCm: event.target.value } : item))} />
                  <input aria-label="宽" inputMode="decimal" value={row.widthCm} onChange={(event) => setSizeRows((current) => current.map((item, i) => i === index ? { ...item, widthCm: event.target.value } : item))} />
                  <button aria-label="删除尺寸行" disabled={sizeRows.length === 1} onClick={() => setSizeRows((current) => current.filter((_, i) => i !== index))} type="button"><Trash2 size={15} /></button>
                </div>
              ))}
              <button className="web-secondary-button" onClick={() => setSizeRows((current) => [...current, { sizeText: "", lengthCm: "", widthCm: "" }])} type="button"><Plus size={15} />添加尺寸</button>
              <small>只保存颜色、尺寸、长、宽；不保存类目、形状、价格、克重、库存或打包数据。</small>
            </div>
          )}
          {type === "packaging" && <div className="publish-workbook-upload"><FileSpreadsheet size={28} /><strong>上传标准打包体积工作簿</strong><span>只接受.xlsx；每个工作表名称作为材质，列必须严格为：宽、长、打包长、打包宽、打包高。</span><label className="web-secondary-button"><Upload size={15} />选择工作簿<input accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={parsePackaging} type="file" /></label>{packaging && <div><CheckCircle2 size={17} /><span><strong>{packaging.materialCount}种材质</strong><small>{packaging.sizeCount}个尺寸 · {packaging.rowCount}条记录</small></span><button aria-label="移除打包表" onClick={() => setPackaging(null)} type="button"><Trash2 size={15} /></button></div>}</div>}
          {type === "tail_image" && (
            <div className="publish-asset-picker">
              <div className="publish-asset-picker__title">
                <div><h4>尾部主图</h4><p>满足 `1340×1785` 或 `1:1` 的图片直接上传；其他图片先在本地浏览器真实裁剪。</p></div>
                <label className="web-primary-button"><Upload size={15} />{tailUploading ? "正在上传" : "连续上传"}<input accept=".jpg,.jpeg,.png,image/jpeg,image/png" disabled={tailUploading} multiple onChange={uploadTailImages} type="file" /></label>
              </div>
              {!!assets.length && (
                <div className="publish-tail-thumbnails">
                  {assets.filter((asset) => selectedAssetIds.includes(asset.id)).map((asset, index) => (
                    <article key={asset.id}>
                      <div className="publish-tail-thumbnails__image">
                        {assetPreviewUrls[asset.id]
                          ? <img alt={asset.originalName || `尾部主图${index + 1}`} src={assetPreviewUrls[asset.id]} />
                          : <span><LoaderCircle className="spin" size={20} /></span>}
                        <b>{index + 1}</b>
                      </div>
                      <div><strong>{asset.originalName || `尾部主图 ${index + 1}`}</strong><small>{asset.width && asset.height ? `${asset.width}×${asset.height}` : "SHEIN主图"}</small></div>
                      <button aria-label={`移除${asset.originalName || "图片"}`} onClick={() => removeTailAsset(asset.id)} type="button"><Trash2 size={15} /></button>
                    </article>
                  ))}
                </div>
              )}
              {!assets.length && <div className="web-empty"><Images size={24} /><strong>还没有尾部主图</strong><small>支持JPG/JPEG/PNG，可一次连续选择多张。</small></div>}
              <div className="publish-tail-rule"><ShieldCheck size={16} /><span>模板只保存图片顺序；引用时永远追加在商品主图最后，不覆盖商品首图。</span></div>
            </div>
          )}
          {type === "compliance" && <div className="publish-compliance-sync"><h4>从当前店铺同步欧代/制造商</h4><p>公司ID、类型、状态只保存到当前店铺；1630/1631仍按每个新SKC单独处理。</p><div><input placeholder="输入当前店铺参照SKC" value={referenceSkc} onChange={(event) => setReferenceSkc(event.target.value)} /><button className="web-secondary-button" disabled={busy} onClick={syncCompliance} type="button"><RefreshCw size={15} />读取平台信息</button></div>{complianceBundle && <label><span>平台可绑定公司/代理</span><select value={selectedAgencyId} onChange={(event) => setSelectedAgencyId(event.target.value)}><option value="">仅保存已同步状态</option>{agencies.map((agency) => <option key={agency.agencyId} value={agency.agencyId}>{agency.agencyName || agency.agencyId}</option>)}</select></label>}</div>}
          <footer>
            <span className={`publish-save-state is-${saveState}`}>
              {saveState === "saving" && <><LoaderCircle className="spin" size={15} />正在保存到云端</>}
              {saveState === "saved" && <><CheckCircle2 size={15} />已保存，可立即引用</>}
              {saveState === "error" && <><AlertCircle size={15} />保存失败，请检查提示</>}
            </span>
            <button className={`web-primary-button${saveState === "saved" ? " is-saved" : ""}`} disabled={busy} onClick={save} type="button">
              {saveState === "saving" ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
              {saveState === "saving" ? "正在保存" : saveState === "saved" ? "保存成功" : editingId ? "更新模板" : "保存模板"}
            </button>
          </footer>
        </section>
        <aside className="publish-template-list">
          <header><div><span className="web-eyebrow">可引用模板</span><h3>{publishTemplateTypes.find((item) => item.id === type)?.label}</h3></div><span>{visibleTemplates.length}个</span></header>
          {visibleTemplates.map((template) => (
            <article key={template.id}>
              <button onClick={() => edit(template)} type="button">
                <span><strong>{template.name}</strong><em>{template.scopeLabel}</em></span>
                <small>v{template.version} · {new Date(template.updatedAt).toLocaleString("zh-CN")}</small>
              </button>
              {template.canManage && <button aria-label={`删除${template.name}`} onClick={() => remove(template)} type="button"><Trash2 size={15} /></button>}
            </article>
          ))}
          {!visibleTemplates.length && <div className="web-empty"><BookOpen size={24} /><strong>还没有此类模板</strong><small>在左侧填写后保存。</small></div>}
        </aside>
      </div>
      <TailImageCropDialog item={tailCropQueue[0]} onCancel={cancelTailCrop} onSave={saveCroppedTailImage} />
      {feedback && <div className={`publish-feedback is-${feedback.kind}`} role="status">{feedback.kind === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}<span>{feedback.message}</span></div>}
    </div>
  );
}

function ProductsPanel({ store }) {
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState([]);
  const [editingDraft, setEditingDraft] = useState(null);
  const [batchImport, setBatchImport] = useState(false);
  const [batches, setBatches] = useState([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  const [batchBusy, setBatchBusy] = useState("");

  useEffect(() => {
    if (!store?.id) return;
    setSelectedDraftIds([]);
    Promise.all([
      requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/product-drafts`,
      ),
      requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/publish-batches`,
      ),
    ])
      .then(([draftResult, batchResult]) => {
        setDrafts(draftResult.drafts || []);
        setBatches(batchResult.batches || []);
      })
      .catch(() => {
        setDrafts([]);
        setBatches([]);
      });
  }, [store?.id]);

  const replaceBatch = (batch) =>
    setBatches((current) => [
      batch,
      ...current.filter((item) => item.id !== batch.id),
    ]);

  const createPublishBatch = async () => {
    if (!selectedDraftIds.length) {
      setNotice("请先勾选至少一个团队商品草稿");
      return;
    }
    setBatchBusy("create");
    setNotice("");
    try {
      const now = new Date();
      const result = await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/publish-batches`,
        {
          method: "POST",
          body: JSON.stringify({
            name: `${now.toLocaleDateString("zh-CN")} 商品预检批次`,
            idempotencyKey:
              globalThis.crypto?.randomUUID?.() ||
              `batch:${Date.now()}:${selectedDraftIds.length}`,
            draftIds: selectedDraftIds,
          }),
        },
      );
      replaceBatch(result.batch);
      setSelectedDraftIds([]);
      setNotice("批次已建立；正式发布仍关闭，可先执行SHEIN只读预检。");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBatchBusy("");
    }
  };

  const actOnBatch = async (batch, action) => {
    setBatchBusy(`${batch.id}:${action}`);
    setNotice("");
    try {
      const result = await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/publish-batches/${encodeURIComponent(batch.id)}/actions`,
        {
          method: "POST",
          body: JSON.stringify({ action }),
        },
      );
      replaceBatch(result.batch);
      if (action === "preflight") {
        setNotice(
          result.batch.state === "ready"
            ? "批次内全部SKU已通过店铺权限和重复校验；正式发布仍关闭。"
            : "批次预检完成，但仍有失败商品，请查看批次明细后重试。",
        );
      }
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBatchBusy("");
    }
  };

  if (editingDraft) {
    return (
      <div className="web-content web-publish-workspace-page">
        <ProductDraftEditor
          draft={editingDraft}
          key={editingDraft.id || "new"}
          onClose={() => setEditingDraft(null)}
          onSaved={(saved) => {
            setDrafts((current) => [
              saved,
              ...current.filter((item) => item.id !== saved.id),
            ]);
            setEditingDraft(saved);
          }}
          store={store}
        />
      </div>
    );
  }

  if (batchImport) {
    return (
      <div className="web-content web-publish-workspace-page">
        <BatchProductImport
          drafts={drafts}
          onClose={() => setBatchImport(false)}
          onSaved={(saved) =>
            setDrafts((current) => [
              ...saved,
              ...current.filter(
                (item) => !saved.some((next) => next.id === item.id),
              ),
            ])
          }
          store={store}
        />
      </div>
    );
  }

  return (
    <div className="web-content">
      <section className="web-page-intro web-publish-hub-intro">
        <div>
          <span className="web-eyebrow">SHEIN 商品创建</span>
          <h2>选择创建方式</h2>
          <p>单品逐项创建，批量按文件夹建立草稿；两条流程都使用当前店铺的真实类目、属性与发布规范。</p>
        </div>
        <span className="web-publish-store-pill"><Store size={15} />{store?.label || "未选择店铺"}</span>
      </section>

      {!store && (
        <div className="web-alert">
          <AlertCircle size={17} />
          <span>当前账号还没有可用的 SHEIN 授权店铺，请先完成店铺授权。</span>
        </div>
      )}

      {notice && (
        <div className="web-alert">
          <AlertCircle size={17} />
          <span>{notice}</span>
        </div>
      )}

      <section className="web-publish-mode-grid">
        <button onClick={() => setEditingDraft({})} type="button">
          <span><ImagePlus size={21} /></span>
          <strong>单个商品创建</strong>
          <small>上传轮播图，引用属性、尺寸、包装和合规模板，再逐个确认SKU。</small>
          <i>进入单品创建 <ChevronDown size={15} /></i>
        </button>
        <button onClick={() => setBatchImport(true)} type="button">
          <span><Upload size={21} /></span>
          <strong>批量创建</strong>
          <small>按商品子文件夹读取图片，统一套用完整规则后生成独立草稿。</small>
          <i>进入批量创建 <ChevronDown size={15} /></i>
        </button>
      </section>

      <section className="web-publish-flow-note">
        <strong>发布链路</strong>
        <span>创建草稿</span><ChevronDown size={14} />
        <span>动态必填校验</span><ChevronDown size={14} />
        <span>SHEIN只读预检</span><ChevronDown size={14} />
        <span>批量发布预览</span>
        <small>标题AI仅预留接口；正式发布开关仍受事件订阅与回执验收控制。</small>
      </section>

      <section className="web-draft-strip">
        <div>
          <span className="web-eyebrow">最近商品草稿</span>
          <strong>{drafts.length} 个</strong>
          <small>只有状态 ready 且预检通过的草稿可入批次</small>
        </div>
        {drafts.slice(0, 20).map((draft) => (
          <article className="web-draft-choice" key={draft.id}>
            <label>
              <input
                checked={selectedDraftIds.includes(draft.id)}
                disabled={!isDraftReadyForBatch(draft)}
                onChange={(event) =>
                  setSelectedDraftIds((current) =>
                    event.target.checked
                      ? [...current, draft.id]
                      : current.filter((id) => id !== draft.id),
                  )
                }
                type="checkbox"
              />
              {isDraftReadyForBatch(draft) ? "选择" : "需先完善"}
            </label>
            <button onClick={() => setEditingDraft(draft)} type="button">
              <span>{draft.name}</span>
              <small>
                {draft.status} · {draft.data?.sizeRows?.length || 1}个SKU
              </small>
            </button>
          </article>
        ))}
        <button
          className="web-create-batch"
          disabled={batchBusy === "create" || !selectedDraftIds.length}
          onClick={createPublishBatch}
          type="button"
        >
          {batchBusy === "create" ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}
          <span>建立预检批次</span>
          <small>已选 {selectedDraftIds.length} 个草稿</small>
        </button>
      </section>
      <section className="web-publish-batches">
        <div className="web-card__head">
          <div>
            <span className="web-eyebrow">流程最下方</span>
            <h3>批量发布预览</h3>
          </div>
          <span>正式发布关闭</span>
        </div>
        <div className="web-batch-task-list">
          {batches.map((batch) => (
            <article key={batch.id}>
              <div>
                <strong>{batch.name}</strong>
                <small>{batch.itemCount}个商品</small>
              </div>
              <span className={`web-task-state web-task-state--${batch.state}`}>
                {publishBatchStateLabels[batch.state] || batch.state}
              </span>
              <div className="web-batch-task-actions">
                {batch.state === "paused" ? (
                  <button
                    disabled={Boolean(batchBusy)}
                    onClick={() => actOnBatch(batch, "resume")}
                    type="button"
                  >
                    <Play size={14} />恢复
                  </button>
                ) : (
                  <button
                    disabled={Boolean(batchBusy) || batch.state === "completed"}
                    onClick={() => actOnBatch(batch, "pause")}
                    type="button"
                  >
                    <Pause size={14} />暂停
                  </button>
                )}
                {batch.state === "failed" && (
                  <button
                    disabled={Boolean(batchBusy)}
                    onClick={() => actOnBatch(batch, "retry")}
                    type="button"
                  >
                    <RotateCcw size={14} />重置失败
                  </button>
                )}
                <button
                  disabled={
                    Boolean(batchBusy) ||
                    ["paused", "preflighting", "completed"].includes(batch.state)
                  }
                  onClick={() => actOnBatch(batch, "preflight")}
                  type="button"
                >
                  {batchBusy === `${batch.id}:preflight` ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <ShieldCheck size={14} />
                  )}
                  只读预检
                </button>
              </div>
              {batch.items?.some((item) => item.lastError) && (
                <small className="web-batch-task-error">
                  {batch.items.find((item) => item.lastError)?.draftName}：
                  {batch.items.find((item) => item.lastError)?.lastError}
                </small>
              )}
            </article>
          ))}
          {!batches.length && (
            <div className="web-empty">
              <ClipboardCheck size={24} />
              <strong>还没有发布预检批次</strong>
              <small>先勾选草稿，再建立一个可暂停、恢复和重试的批次。</small>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

async function parseWebPublishFolders(fileList) {
  const images = Array.from(fileList).filter(
    (file) => file.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(file.name),
  );
  const inspected = await Promise.all(
    images.map(async (file, index) => {
      const dimensions = await readImageDimensions(file);
      const type = classifyPublishImage(file.name);
      return {
        id: `${file.webkitRelativePath || file.name}-${index}`,
        file,
        type,
        width: dimensions.width || 0,
        height: dimensions.height || 0,
        sizeLabel: formatImageSize(file.size),
        issues: validatePublishImage(
          file,
          type,
          dimensions.width,
          dimensions.height,
        ),
      };
    }),
  );
  const groups = new Map();
  inspected.forEach((image) => {
    const parts = (image.file.webkitRelativePath || image.file.name)
      .split("/")
      .filter(Boolean);
    const folder = parts.length >= 3 ? parts[1] : parts[0] || "未命名商品";
    const group = groups.get(folder) || { name: folder, files: [] };
    group.files.push(image);
    groups.set(folder, group);
  });
  return Array.from(groups.values()).map(buildPublishProduct);
}

function BatchProductImport({ store, drafts, onSaved, onClose }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");
  const [templateDraftId, setTemplateDraftId] = useState("");
  const [completed, setCompleted] = useState(false);
  const templateDrafts = drafts.filter(isDraftReadyForBatch);
  const templateDraft = templateDrafts.find(
    (draft) => draft.id === templateDraftId,
  );

  const chooseFolder = async (event) => {
    const files = event.target.files;
    if (!files?.length) return;
    setLoading(true);
    setNotice("");
    setCompleted(false);
    try {
      setProducts(await parseWebPublishFolders(files));
    } catch {
      setNotice("文件夹解析失败，请检查图片格式。");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  };

  const saveBatch = async () => {
    if (!products.length) return;
    setLoading(true);
    setCompleted(false);
    const saved = [];
    const failed = [];
    const supplierCodes = buildUniqueBatchSupplierCodes(products);
    try {
      for (const [index, product] of products.entries()) {
        setProgress(`${index + 1}/${products.length} ${product.name}`);
        const inferredCode = supplierCodes[index];
        const templateData = templateDraft?.data || {};
        const templateRows = Array.isArray(templateData.sizeRows)
          ? templateData.sizeRows
          : [];
        const sizeRows = templateRows.map((row, rowIndex) => {
          const label = String(row.sheinValueLabel || row.name || rowIndex + 1)
            .toUpperCase()
            .replace(/[×xX＊*\s]+/g, "X")
            .replace(/[^A-Z0-9-]+/g, "");
          return createWebSkuRow({
            supplierCode: inferredCode,
            index: rowIndex,
            source: {
              ...row,
              id:
                globalThis.crypto?.randomUUID?.() ||
                `${inferredCode}-${rowIndex}-${Date.now()}`,
              supplierSku: `${inferredCode}-${label || String(rowIndex + 1).padStart(2, "0")}`,
            },
          });
        });
        const baseRows =
          sizeRows.length > 0
            ? sizeRows
            : [
                createWebSkuRow({
                  supplierCode: inferredCode,
                  source: { supplierSku: `${inferredCode}-01` },
                }),
              ];
        const uploaded = [];
        const uploadBlockers = [];
        for (const image of product.files.filter(
          (item) => !item.issues.length,
        )) {
          try {
            const asset = await uploadWebMediaFile({
              storeId: store.id,
              file: image.file,
              purpose: "selected_unpublished",
            });
            uploaded.push({ imageId: image.id, asset });
          } catch (error) {
            uploadBlockers.push(
              `${image.file.name}：${error.message || "对象存储上传失败"}`,
            );
          }
        }
        const attached = attachBatchImageAssets({
          product,
          uploaded,
          sizeRows: baseRows,
        });
        const importBlockers = [
          ...product.blockers,
          ...uploadBlockers,
          ...attached.blockers,
        ];
        try {
          const result = await requestWebApi(
            `/v1/web/stores/${encodeURIComponent(store.id)}/product-drafts`,
            {
              method: "POST",
              body: JSON.stringify({
                name: product.name,
                categoryId: templateDraft?.categoryId || "",
                productTypeId: templateDraft?.productTypeId || "",
                data: {
                  ...templateData,
                  title: product.name,
                  supplierCode: inferredCode,
                  supplierSku:
                    attached.sizeRows[0]?.supplierSku || `${inferredCode}-01`,
                  sizeRows: attached.sizeRows,
                  mainAssetId: attached.mainAssetId,
                  imageAssets: attached.imageAssets,
                  importedImageCount: product.files.length,
                  uploadedImageCount: uploaded.length,
                  imageSlots: Object.fromEntries(
                    [
                      "main",
                      "detail",
                      "square",
                      "swatch",
                      "description",
                      "sku",
                    ].map((slot) => [
                      slot,
                      attached.imageAssets[slot].length,
                    ]),
                  ),
                  importBlockers,
                },
                preflight: {
                  passed: false,
                  blockers: [
                    "批量导入草稿需逐个确认标题、图片、尺寸和包装后再预检",
                  ],
                },
                status: "blocked",
              }),
            },
          );
          saved.push(result.draft);
        } catch (error) {
          failed.push(`${product.name}：${error.message}`);
        }
      }
      if (saved.length) onSaved(saved);
      setCompleted(saved.length > 0 && failed.length === 0);
      setNotice(
        [
          templateDraft
            ? `已生成${saved.length}个待确认草稿，并套用“${templateDraft.name}”的类目、属性、尺寸和包装配置。`
            : `已生成${saved.length}个空白草稿。`,
          "请逐个打开并保存预检，通过后才可加入发布批次。",
          failed.length ? `${failed.length}个商品保存失败：${failed.join("；")}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (error) {
      setNotice(`${progress || "批量导入"}失败：${error.message}`);
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  return (
    <section className="web-batch-import">
      <header><div><span className="web-eyebrow">批量发品入口</span><h3>按子文件夹识别商品</h3></div><button onClick={onClose} type="button"><X size={18} /></button></header>
      <div className="web-batch-template-picker">
        <label>
          <span>统一套用已完善草稿</span>
          <select
            value={templateDraftId}
            onChange={(event) => setTemplateDraftId(event.target.value)}
          >
            <option value="">不套用，生成空白草稿</option>
            {templateDrafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draft.name} · {draft.data?.sizeRows?.length || 1}个SKU
              </option>
            ))}
          </select>
        </label>
        <small>
          复用类目、属性、尺寸、材质包装表、克重和每行价格库存；商品标题、SKC/SKU货号及主图仍按文件夹独立生成。
        </small>
      </div>
      <label className="web-folder-picker"><Upload size={18} /><span>{loading ? progress || "正在解析" : "选择批量根目录"}</span><input disabled={loading} multiple onChange={chooseFolder} type="file" webkitdirectory="" /></label>
      {notice && <div className="web-alert"><AlertCircle size={17} /><span>{notice}</span></div>}
      <div className="web-batch-products">
        {products.map((product) => <article key={product.id}><strong>{product.name}</strong><span>{product.files.length}张图 · 主图{product.main.length} · 细节图{product.detail.length} · SKU图{product.sku.length}</span><small>{product.blockers.length ? `${product.blockers.length}个图片阻断` : "图片规则通过"}</small></article>)}
      </div>
      <footer><button className="web-primary-button" disabled={loading || !products.length || completed} onClick={saveBatch} type="button">{loading ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}{completed ? "批量草稿已生成" : "生成批量草稿"}</button></footer>
    </section>
  );
}

function ProductDraftEditor({ store, draft, onSaved, onClose }) {
  const sourceData = draft.data || {};
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState(
    draft.categoryId
      ? {
          categoryId: draft.categoryId,
          productTypeId: draft.productTypeId,
          name: sourceData.categoryName || draft.categoryId,
        }
      : null,
  );
  const [schema, setSchema] = useState(null);
  const [assets, setAssets] = useState([]);
  const [publishTemplates, setPublishTemplates] = useState([]);
  const [pricePerSquareMeter, setPricePerSquareMeter] = useState("");
  const [bulkInventory, setBulkInventory] = useState("");
  const [bulkSizeHeight, setBulkSizeHeight] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [imageCropQueue, setImageCropQueue] = useState([]);
  const [assetPreviewUrls, setAssetPreviewUrls] = useState({});
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [data, setData] = useState(() => {
    const supplierCode = sourceData.supplierCode || "";
    const legacyRow = sourceData.supplierSku
      ? {
          supplierSku: sourceData.supplierSku,
          costPrice: sourceData.costPrice || "",
          inventoryNum: sourceData.inventoryNum ?? "0",
          packageLengthCm: sourceData.length || "",
          packageWidthCm: sourceData.width || "",
          packageHeightCm: sourceData.height || "",
          weightGrams: sourceData.weight || "",
          packageMatch: "manual",
        }
      : {};
    const rows = Array.isArray(sourceData.sizeRows) && sourceData.sizeRows.length
      ? sourceData.sizeRows.map((row, index) =>
          createWebSkuRow({ supplierCode, index, source: row }),
        )
      : [createWebSkuRow({ supplierCode, source: legacyRow })];
    return {
      title: "",
      supplierCode: "",
      mainAssetId: "",
      attributeValues: {},
      skcSaleAttributeId: "",
      skcSaleAttributeValueId: "",
      shape: "rectangle",
      gramsPerSquareMeter: "",
      packagingMaterial: "",
      packagingWorkbook: null,
      ...sourceData,
      mainAssetIds: Array.isArray(sourceData.mainAssetIds)
        ? sourceData.mainAssetIds
        : sourceData.mainAssetId ? [sourceData.mainAssetId] : [],
      sizeRows: rows,
    };
  });
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = schema
    ? buildAttributeFields(schema.attributes, category?.productTypeId)
    : [];
  const productFields = fields.filter((field) => [3, 4].includes(field.typeCode));
  const requiredFields = productFields.filter((field) => field.required);
  const sizeAttributeFields = fields.filter((field) => field.typeCode === 2);
  const sizeSaleFields = fields.filter(
    (field) =>
      field.typeCode === 1 && /尺寸|尺码|规格|size/i.test(field.name),
  );
  const sizeOptions = sizeSaleFields.flatMap((field) =>
    field.values.map((value) => ({
      ...value,
      fieldId: field.id,
      fieldName: field.name,
    })),
  );
  const mainSaleFields = fields.filter(
    (field) =>
      field.typeCode === 1 &&
      Number(field.labelCode) === 1 &&
      !sizeSaleFields.some((sizeField) => String(sizeField.id) === String(field.id)),
  );
  const publishStandard = getWebPublishStandard(schema?.publishStandard);
  const currency = publishStandard.currency || "";
  const weightRequired = isWebRuleRequired(publishStandard.weight_config, true);
  const dimensionsRequired = isWebRuleRequired(
    publishStandard.length_width_height_config,
    true,
  );
  const weightUnits = publishStandard.weight_config?.available_units || ["g"];
  const dimensionUnits =
    publishStandard.length_width_height_config?.available_units || ["cm"];
  const titleMaxLength = Number(
    publishStandard.default_language_title_max_length || 0,
  );
  const materials = Object.keys(data.packagingWorkbook?.materials || {});

  useEffect(() => {
    Promise.all([
      requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/publish/categories`,
      ),
      requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/media?limit=100`,
      ),
      requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/publish-templates`,
      ),
    ])
      .then(([categoryResult, mediaResult, templateResult]) => {
        setCategories(flattenLeafCategories(categoryResult.info || {}));
        setAssets(
          (mediaResult.assets || []).filter(
            (asset) =>
              asset.status === "ready" &&
              String(asset.contentType).startsWith("image/"),
          ),
        );
        setPublishTemplates(templateResult.templates || []);
      })
      .catch((error) => setNotice(error.message));
  }, [store.id]);

  useEffect(() => {
    if (!category?.categoryId || !category?.productTypeId) {
      setSchema(null);
      return;
    }
    setBusy(true);
    requestWebApi(
      `/v1/web/stores/${encodeURIComponent(store.id)}/publish/schema`,
      {
        method: "POST",
        body: JSON.stringify(category),
      },
    )
      .then(setSchema)
      .catch((error) => setNotice(error.message))
      .finally(() => setBusy(false));
  }, [category?.categoryId, category?.productTypeId, store.id]);

  useEffect(() => {
    const selectedIds = [
      ...(data.mainAssetIds || []),
      ...data.sizeRows.map((row) => row.imageAssetId).filter(Boolean),
    ].filter((id) => !assetPreviewUrls[id]);
    if (!selectedIds.length) return;
    let cancelled = false;
    Promise.allSettled(selectedIds.map(async (assetId) => {
      const ticket = await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/media/${encodeURIComponent(assetId)}/download-ticket`,
      );
      return [assetId, ticket.download?.url || ""];
    })).then((results) => {
      if (cancelled) return;
      const entries = results.flatMap((result) =>
        result.status === "fulfilled" && result.value[1] ? [result.value] : [],
      );
      if (entries.length) {
        setAssetPreviewUrls((current) => ({ ...current, ...Object.fromEntries(entries) }));
      }
    });
    return () => { cancelled = true; };
  }, [data.mainAssetIds, data.sizeRows, assetPreviewUrls, store.id]);

  const update = (key, value) =>
    setData((current) => ({ ...current, [key]: value }));

  const attachUploadedImage = (asset, previewUrl, target = {}) => {
    setAssets((current) => [asset, ...current.filter((item) => item.id !== asset.id)]);
    if (previewUrl) {
      setAssetPreviewUrls((current) => ({ ...current, [asset.id]: previewUrl }));
    }
    setData((current) => {
      if (target.rowId) {
        return {
          ...current,
          sizeRows: current.sizeRows.map((row) =>
            row.id === target.rowId ? { ...row, imageAssetId: asset.id } : row,
          ),
        };
      }
      const ids = [...new Set([...(current.mainAssetIds || []), asset.id])].slice(0, 11);
      return { ...current, mainAssetIds: ids, mainAssetId: ids[0] || "" };
    });
  };

  const uploadDraftImage = async (file, previewUrl, target = {}) => {
    const asset = await uploadWebMediaFile({
      storeId: store.id,
      file,
      purpose: "selected_unpublished",
    });
    attachUploadedImage({ ...asset, storeId: store.id }, previewUrl, target);
  };

  const chooseDraftImages = async (event, target = {}) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    setImageUploading(true);
    const queue = [];
    const failures = [];
    for (const file of files.slice(0, target.rowId ? 1 : 11)) {
      try {
        if (!/^image\/(jpeg|png)$/i.test(file.type) && !/\.(jpe?g|png)$/i.test(file.name)) {
          throw new Error(`${file.name}：SHEIN商品图只接受JPG/JPEG/PNG`);
        }
        const prepared = await prepareWebImageFile(file);
        const dimensions = await readImageDimensions(prepared);
        const previewUrl = URL.createObjectURL(prepared);
        if (isSheinMainImageReady({ ...dimensions, sizeBytes: prepared.size })) {
          await uploadDraftImage(prepared, previewUrl, target);
        } else {
          queue.push({
            id: `${Date.now()}-${queue.length}-${prepared.name}`,
            file: prepared,
            url: previewUrl,
            target,
            presetId: dimensions.width === dimensions.height ? "square" : "portrait",
          });
        }
      } catch (error) {
        failures.push(error.message);
      }
    }
    setImageCropQueue((current) => [...current, ...queue]);
    setImageUploading(false);
    if (failures.length) setNotice(failures.join("；"));
    else if (queue.length) setNotice(`${queue.length}张图片不符合SHEIN像素规范，请完成浏览器本地裁剪`);
    else setNotice("图片已直接上传，未经过服务器转码");
  };

  const saveCroppedDraftImage = async (file) => {
    const current = imageCropQueue[0];
    const previewUrl = URL.createObjectURL(file);
    try {
      await uploadDraftImage(file, previewUrl, current?.target || {});
      if (current?.url) URL.revokeObjectURL(current.url);
      setImageCropQueue((queue) => queue.slice(1));
      setNotice(`“${current?.file?.name || file.name}”已裁剪并上传`);
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setNotice(`裁剪结果上传失败：${error.message}`);
      throw error;
    }
  };

  const cancelDraftCrop = () => {
    const current = imageCropQueue[0];
    if (current?.url) URL.revokeObjectURL(current.url);
    setImageCropQueue((queue) => queue.slice(1));
  };

  const removeDraftImage = (assetId, rowId = "") => {
    const preview = assetPreviewUrls[assetId];
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    setAssetPreviewUrls((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
    setData((current) => {
      if (rowId) {
        return {
          ...current,
          sizeRows: current.sizeRows.map((row) =>
            row.id === rowId ? { ...row, imageAssetId: "" } : row,
          ),
        };
      }
      const ids = (current.mainAssetIds || []).filter((id) => id !== assetId);
      return { ...current, mainAssetIds: ids, mainAssetId: ids[0] || "" };
    });
  };

  const updateSupplierCode = (value) =>
    setData((current) => ({
      ...current,
      supplierCode: value,
      sizeRows: current.sizeRows.map((row, index) => ({
        ...row,
        supplierSku:
          !row.supplierSku || row.supplierSku.startsWith("SKU-")
            ? `${value || "SKU"}-${String(index + 1).padStart(2, "0")}`
            : row.supplierSku,
      })),
    }));

  const changeShape = (shape) =>
    setData((current) => ({
      ...current,
      shape,
      sizeRows: current.sizeRows.map((row) => {
        const option = sizeOptions.find(
          (item) =>
            String(item.fieldId) === String(row.sheinAttributeId) &&
            String(item.id) === String(row.sheinAttributeValueId),
        );
        return option
          ? {
              ...applySheinSizeOption(row, option, {
                shape,
                sizeAttributeFields,
              }),
              supplierSku: row.supplierSku,
              costPrice: row.costPrice,
              inventoryNum: row.inventoryNum,
            }
          : { ...row, shape, packageMatch: "pending" };
      }),
    }));

  const updateSizeRow = (id, patch) =>
    setData((current) => ({
      ...current,
      sizeRows: current.sizeRows.map((row) =>
        row.id === id ? { ...row, ...patch } : row,
      ),
    }));

  const updateSizeAttribute = (row, field, value) => {
    const name = `${field.name || ""} ${field.nameEn || ""}`;
    const dimensions = {};
    if (/直径|diameter/i.test(name)) dimensions.diameterCm = value;
    else if (/宽度|width/i.test(name)) dimensions.widthCm = value;
    else if (/长度|length/i.test(name)) dimensions.lengthCm = value;
    updateSizeRow(row.id, {
      ...dimensions,
      sizeAttributeValues: {
        ...(row.sizeAttributeValues || {}),
        [String(field.id)]: value,
      },
      packageMatch: "pending",
    });
  };

  const selectSize = (row, rawValue) => {
    const option = sizeOptions.find(
      (item) => `${item.fieldId}:${item.id}` === rawValue,
    );
    if (!option) {
      updateSizeRow(row.id, {
        sheinValueId: "",
        sheinAttributeId: "",
        sheinAttributeValueId: "",
        sheinValueLabel: "",
      });
      return;
    }
    const next = applySheinSizeOption(row, option, {
      shape: data.shape,
      sizeAttributeFields,
    });
    const skuSuffix = String(option.label || "")
      .toUpperCase()
      .replace(/[×xX＊*\s]+/g, "X")
      .replace(/[^A-Z0-9-]+/g, "");
    updateSizeRow(row.id, {
      ...next,
      supplierSku:
        row.supplierSku ||
        `${data.supplierCode || "SKU"}-${skuSuffix || data.sizeRows.indexOf(row) + 1}`,
    });
  };

  const importPackaging = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setNotice("");
    try {
      if (!/\.xlsx$/i.test(file.name)) {
        throw new Error("只允许上传标准 .xlsx 工作簿");
      }
      const { default: readExcelFile } = await import("read-excel-file/browser");
      const normalized = normalizePackagingWorkbook(await readExcelFile(file));
      if (!normalized.materialCount || normalized.issues.length) {
        throw new Error(normalized.issues[0] || "没有读取到可用材质表");
      }
      const firstMaterial = Object.keys(normalized.materials)[0] || "";
      setData((current) => ({
        ...current,
        packagingMaterial: firstMaterial,
        packagingWorkbook: {
          fileName: file.name,
          importedAt: new Date().toISOString(),
          ...normalized,
        },
      }));
      setNotice(
        `已解析${normalized.materialCount}种材质、${normalized.sizeCount}个尺寸、${normalized.rowCount}条包装记录${normalized.overwrittenCount ? `；${normalized.overwrittenCount}条重复尺寸已按最后一行覆盖` : ""}。`,
      );
    } catch (error) {
      setNotice(`包装体积表读取失败：${error.message}`);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const resolvePackaging = () => {
    const materialRows =
      data.packagingWorkbook?.materials?.[data.packagingMaterial] || [];
    if (!materialRows.length) {
      setNotice("请先导入包装体积表并选择材质");
      return;
    }
    const rows = enrichSizeRows(data.sizeRows, {
      materialRows,
    });
    update("sizeRows", rows);
    const matched = rows.filter((row) => row.packageMatch === "matched").length;
    setNotice(
      `已匹配${matched}个SKU包装体积，${rows.length - matched}个尺寸需手工补充；产品重量（含包装）不会由体积表推算。`,
    );
  };

  const applyPricePerSquareMeter = () => {
    if (!(Number(pricePerSquareMeter) > 0)) {
      setNotice("请输入大于0的每平方米供货价");
      return;
    }
    setData((current) => ({
      ...current,
      sizeRows: current.sizeRows.map((row) => {
        const area = calculateAreaSquareMeters(row);
        return {
          ...row,
          costPrice: area === null
            ? row.costPrice
            : (area * Number(pricePerSquareMeter)).toFixed(2),
        };
      }),
    }));
    setNotice("已按成品长×宽换算每个SKU供货价；圆形按你指定的直径×直径计算");
  };

  const applyGramsPerSquareMeter = () => {
    if (!(Number(data.gramsPerSquareMeter) > 0)) {
      setNotice("请输入大于0的每平方米克重");
      return;
    }
    setData((current) => ({
      ...current,
      sizeRows: current.sizeRows.map((row) => ({
        ...row,
        weightGrams:
          calculateWeightGrams(row, current.gramsPerSquareMeter) ??
          row.weightGrams,
      })),
    }));
    setNotice("已按每平方米克重计算产品重量（含包装），并写入每个SKU");
  };

  const applyBulkInventory = () => {
    if (!Number.isInteger(Number(bulkInventory)) || Number(bulkInventory) < 0 || Number(bulkInventory) > 99999) {
      setNotice("统一库存需为0-99999的整数");
      return;
    }
    setData((current) => ({
      ...current,
      sizeRows: current.sizeRows.map((row) => ({ ...row, inventoryNum: String(bulkInventory) })),
    }));
    setNotice(`已给${data.sizeRows.length}个SKU统一填写库存`);
  };

  const applyBulkSizeHeight = () => {
    if (!(Number(bulkSizeHeight) > 0)) {
      setNotice("请输入大于0的尺码表高度");
      return;
    }
    const heightField = sizeAttributeFields.find((field) =>
      /高度|height/i.test(`${field.name || ""} ${field.nameEn || ""}`),
    );
    setData((current) => ({
      ...current,
      sizeRows: current.sizeRows.map((row) => ({
        ...row,
        sizeChartHeightCm: String(bulkSizeHeight),
        sizeAttributeValues: heightField ? {
          ...(row.sizeAttributeValues || {}),
          [String(heightField.id)]: String(bulkSizeHeight),
        } : row.sizeAttributeValues,
      })),
    }));
    setNotice(heightField
      ? `已将尺码表“${heightField.name}”统一应用到全部SKU`
      : "已保存统一高度；当前类目未返回可映射的高度字段，正式提交前会阻断人工确认");
  };

  const applyPublishTemplate = (templateId) => {
    const template = publishTemplates.find((item) => item.id === templateId);
    if (!template) return;
    if (template.categoryId) {
      const matchedCategory = categories.find(
        (item) => String(item.categoryId) === String(template.categoryId),
      );
      if (!matchedCategory) {
        setNotice(`模板“${template.name}”的类目已不在当前店铺类目树中，请到模板中心重新校验`);
        return;
      }
      setCategory(matchedCategory);
    }
    if (template.templateType === "attribute") {
      setData((current) => ({
        ...current,
        attributeValues: Object.fromEntries(
          (template.data?.assignments || []).map((item) => [
            String(item.attributeId),
            { valueIds: item.valueIds || [], customValue: item.customValue || "" },
          ]),
        ),
        attributeTemplateId: template.id,
        rugReportSources: template.data?.rugReportSources || null,
      }));
    } else if (template.templateType === "size") {
      setData((current) => ({
        ...current,
        sizeTemplateId: template.id,
        sizeTemplateColorText: template.data?.colorText || template.data?.rows?.[0]?.colorLabel || "",
        sizeRows: (template.data?.rows || []).map((row, index) =>
          createWebSkuRow({
            supplierCode: current.supplierCode,
            index,
            source: {
              shape: current.shape,
              widthCm: row.widthCm,
              lengthCm: row.lengthCm,
              templateSizeText: row.sizeText || row.sizeLabel || "",
              name: row.sizeText || row.sizeLabel || "",
            },
          }),
        ),
      }));
    } else if (template.templateType === "packaging") {
      setData((current) => ({
        ...current,
        packagingTemplateId: template.id,
        packagingWorkbook: template.data,
        packagingMaterial: Object.keys(template.data?.materials || {})[0] || "",
      }));
    } else if (template.templateType === "tail_image") {
      setData((current) => ({ ...current, tailImageTemplateId: template.id, tailAssetIds: template.data?.assetIds || [] }));
    } else if (template.templateType === "compliance") {
      setData((current) => ({ ...current, complianceTemplateId: template.id, complianceTemplateSnapshot: template.data }));
    }
    setNotice(template.templateType === "size"
      ? `已引用“${template.name}”；请在当前类目下确认颜色，并为每个自定义尺寸匹配SHEIN真实值`
      : `已引用模板“${template.name}”；保存草稿前会按当前SHEIN规则重新校验`);
  };

  const skuValues = data.sizeRows.map((row) => row.supplierSku.trim()).filter(Boolean);
  const duplicateSkuCount = skuValues.length - new Set(skuValues).size;
  const skuImageCount = data.sizeRows.filter((row) => row.imageAssetId).length;
  const localBlockers = [
    !category && "请选择SHEIN末级类目",
    !data.title.trim() && "缺少商品标题",
    titleMaxLength > 0 && data.title.length > titleMaxLength &&
      `商品标题超过SHEIN当前类目上限${titleMaxLength}个字符`,
    !data.supplierCode.trim() && "缺少商家SKC货号",
    !(data.mainAssetIds || []).length && "缺少商品轮播主图",
    (data.mainAssetIds || []).length > 11 && "商品轮播图最多11张",
    mainSaleFields.length > 0 &&
      (!data.skcSaleAttributeId || !data.skcSaleAttributeValueId) &&
      "缺少SKC主销售属性",
    schema && !currency && "发布规范未返回供货价币种",
    !data.sizeRows.length && "至少添加一个SKU尺寸",
    duplicateSkuCount > 0 && `存在${duplicateSkuCount}个重复商家SKU`,
    skuImageCount > 0 && skuImageCount < data.sizeRows.length &&
      "SHEIN规则：任一SKU上传预览图后，全部SKU都必须上传预览图",
    ...(data.importBlockers || []),
    ...requiredFields
      .filter(
        (field) =>
          !(data.attributeValues?.[String(field.id)]?.valueIds || []).length &&
          !data.attributeValues?.[String(field.id)]?.customValue,
      )
      .map((field) => `必填属性“${field.name}”未填写`),
    ...data.sizeRows.flatMap((row, index) => {
      const label = row.sheinValueLabel || `第${index + 1}个SKU`;
      return [
        !row.sheinAttributeId && `${label}未选择SHEIN尺寸值`,
        !row.supplierSku.trim() && `${label}缺少商家SKU`,
        (
          !String(row.costPrice ?? "").trim() ||
          !/^\d+(?:\.\d{1,2})?$/.test(String(row.costPrice)) ||
          Number(row.costPrice) > 100000
        ) && `${label}供货价需为0-100000且最多2位小数`,
        !Number.isInteger(Number(row.inventoryNum)) && `${label}库存必须为整数`,
        !(
          Number(row.inventoryNum) >= 0 &&
          Number(row.inventoryNum) <= 99999
        ) && `${label}库存需为0-99999`,
        dimensionsRequired && !["packageLengthCm", "packageWidthCm", "packageHeightCm"].every(
          (key) => Number(row[key]) > 0,
        ) && `${label}缺少含包装长宽高`,
        weightRequired && !(Number(row.weightGrams) > 0) &&
          `${label}缺少产品重量（含包装）`,
        ...sizeAttributeFields
          .filter(
            (field) =>
              field.required &&
              !(Number(row.sizeAttributeValues?.[String(field.id)]) > 0),
          )
          .map((field) => `${label}缺少尺码表字段“${field.name}”`),
      ].filter(Boolean);
    }),
  ].filter(Boolean);

  const save = async () => {
    setSaveAttempted(true);
    if (localBlockers.length) {
      window.requestAnimationFrame(() => {
        document.querySelector(".web-product-editor .is-invalid")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    setBusy(true);
    setNotice("");
    try {
      let preflight = {};
      let associatedRules = [];
      if (!localBlockers.length) {
        const assignments = productFields.flatMap((field) => {
          const assignment = data.attributeValues?.[String(field.id)] || {};
          const valueIds = Array.isArray(assignment.valueIds)
            ? assignment.valueIds.map(String).filter(Boolean)
            : [];
          if (valueIds.length) {
            return valueIds.map((valueId) => ({
              attributeId: String(field.id),
              attributeValueId: valueId,
            }));
          }
          return String(assignment.customValue || "").trim()
            ? [{ attributeId: String(field.id) }]
            : [];
        });
        const linked = await requestWebApi(
          `/v1/web/stores/${encodeURIComponent(store.id)}/publish/associated-rules`,
          {
            method: "POST",
            body: JSON.stringify({
              categoryId: category.categoryId,
              productTypeId: category.productTypeId,
              attributeList: assignments,
            }),
          },
        );
        associatedRules =
          linked.info?.data?.[0]?.link_rule_attribute_list || [];
        const linkedMissing = associatedRules.filter((rule) => {
          const fieldId = String(rule.attribute_id);
          if (!productFields.some((field) => String(field.id) === fieldId)) {
            return false;
          }
          const assigned = assignments.filter(
            (item) => String(item.attributeId) === fieldId,
          );
          if (!assigned.length) return true;
          const allowed = [
            ...(rule.attribute_value_list || []),
            ...(rule.attribute_value_pre_fill_list || []),
          ].map(String);
          return allowed.length > 0 && !assigned.some(
            (item) => allowed.includes(String(item.attributeValueId || "")),
          );
        });
        if (linkedMissing.length) {
          throw new Error(
            `SHEIN关联规则要求补充：${linkedMissing.map((rule) =>
              productFields.find(
                (field) => String(field.id) === String(rule.attribute_id),
              )?.name || rule.attribute_id,
            ).join("、")}`,
          );
        }
        preflight = await requestWebApi(
          `/v1/web/stores/${encodeURIComponent(store.id)}/publish/preflight`,
          {
            method: "POST",
            body: JSON.stringify({ supplierSkuList: skuValues }),
          },
        );
      }
      const result = await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/product-drafts`,
        {
          method: "POST",
          body: JSON.stringify({
            id: draft.id,
            name: data.title || "未命名商品",
            categoryId: category?.categoryId,
            productTypeId: category?.productTypeId,
            data: {
              ...data,
              sourceSystem: "OpenAPI",
              suitFlag: 0,
              mainAssetId: (data.mainAssetIds || [])[0] || "",
              associatedRules,
              attributeSchemaSnapshot: {
                fetchedAt: new Date().toISOString(),
                fields: productFields.map((field) => ({
                  id: String(field.id),
                  name: field.name,
                  typeCode: Number(field.typeCode),
                  dataDimension: Number(field.dataDimension || 0),
                  values: (field.values || []).map((value) => ({
                    id: String(value.id),
                    label: value.label,
                  })),
                })),
              },
              publishStandardSnapshot: {
                fetchedAt: new Date().toISOString(),
                weightConfig: publishStandard.weight_config || null,
                dimensionConfig:
                  publishStandard.length_width_height_config || null,
              },
              supplierSku: data.sizeRows[0]?.supplierSku || "",
              categoryName: category?.name,
              currency,
            },
            preflight,
            status:
              !localBlockers.length && preflight.passed
                ? "ready"
                : "blocked",
          }),
        },
      );
      onSaved(result.draft);
      const rugBlockerCount =
        result.draft.preflight?.rugReport?.blockers?.length || 0;
      setNotice(
        result.draft.status === "ready"
          ? `${data.sizeRows.length}个SKU已通过店铺权限和重复校验；正式发布仍关闭。`
          : `草稿已保存，还有${localBlockers.length + rugBlockerCount}个阻断项。`,
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const selectedMainSale =
    data.skcSaleAttributeId && data.skcSaleAttributeValueId
      ? `${data.skcSaleAttributeId}:${data.skcSaleAttributeValueId}`
      : "";

  return (
    <section className="web-product-editor">
      <header>
        <div>
          <span className="web-eyebrow">单个商品创建</span>
          <h3>{draft.id ? "继续编辑商品草稿" : "创建一个新商品"}</h3>
          <small>从模板和图片开始，最后生成标题并执行真实必填预检。</small>
        </div>
        <button aria-label="返回商品发布" onClick={onClose} type="button"><X size={18} /></button>
      </header>
      {notice && <div className="web-alert"><AlertCircle size={17} /><span>{notice}</span></div>}
      <details className="web-publish-template-references">
        <summary>
          <span><BookOpen size={15} /><strong>引用模板</strong><small>商品属性、尺寸、包装、尾图和店铺合规</small></span>
          <i>按需展开 <ChevronDown size={14} /></i>
        </summary>
        <div className="web-publish-template-references__body">
          <small>管理员模板全员通用；成员模板在本人全部店铺通用；过期类目和字段会被阻断。</small>
          <div>
          {publishTemplateTypes.map((templateType) => (
            <label key={templateType.id}>
              <span>{templateType.label}</span>
              <select defaultValue="" onChange={(event) => applyPublishTemplate(event.target.value)}>
                <option value="">不引用</option>
                {publishTemplates
                  .filter((template) => template.templateType === templateType.id)
                  .map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
          ))}
          </div>
        </div>
      </details>
      <section className={`web-publish-carousel${saveAttempted && !(data.mainAssetIds || []).length ? " is-invalid" : ""}`}>
        <header>
          <div><span className="web-eyebrow">第一步</span><h4>商品轮播图</h4><small>第1张作为主图，后续为详情轮播；尾部主图模板只追加到最后。</small></div>
          <label className="web-secondary-button">
            {imageUploading ? <LoaderCircle className="spin" size={15} /> : <Upload size={15} />}
            {imageUploading ? "正在直传" : "连续上传图片"}
            <input accept=".jpg,.jpeg,.png,image/jpeg,image/png" disabled={imageUploading} multiple onChange={(event) => chooseDraftImages(event)} type="file" />
          </label>
        </header>
        <div className="web-publish-carousel__items">
          {(data.mainAssetIds || []).map((assetId, index) => {
            const asset = assets.find((item) => item.id === assetId);
            return (
              <article key={assetId}>
                {assetPreviewUrls[assetId]
                  ? <img alt={asset?.originalName || `轮播图${index + 1}`} src={assetPreviewUrls[assetId]} />
                  : <span><ImagePlus size={22} /></span>}
                <strong>{index === 0 ? "主图" : `轮播 ${index + 1}`}</strong>
                <small>{asset?.originalName || "已上传图片"}</small>
                <button aria-label="移除图片" onClick={() => removeDraftImage(assetId)} type="button"><Trash2 size={14} /></button>
              </article>
            );
          })}
          {!(data.mainAssetIds || []).length && <div className="web-publish-carousel__empty"><ImagePlus size={25} /><strong>上传商品轮播图</strong><small>不符合1340×1785或1:1规范时才弹出本地裁剪。</small></div>}
        </div>
        {saveAttempted && !(data.mainAssetIds || []).length && <em>缺少商品轮播主图</em>}
      </section>

      <section className={`web-publish-title-assistant${saveAttempted && !data.title.trim() ? " is-invalid" : ""}`}>
        <header><div><span className="web-eyebrow">标题与草稿</span><h3>商品标题</h3></div><span>AI 标题接口已预留，模型与判断规则待确认</span></header>
        <label>
          <span>当前默认语言标题{titleMaxLength ? `（最多${titleMaxLength}字符）` : ""}</span>
          <textarea maxLength={titleMaxLength || undefined} placeholder="先人工填写准确标题；不得虚构材质、厚度、防滑、可水洗或认证信息" value={data.title} onChange={(event) => update("title", event.target.value)} />
        </label>
        <footer>
          <small>{data.title.length}{titleMaxLength ? ` / ${titleMaxLength}` : ""}字符</small>
          <div>
            <button className="web-secondary-button" disabled type="button"><WandSparkles size={15} />AI生成标题（预留）</button>
            <button className="web-primary-button" disabled={busy} onClick={save} type="button">{busy ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}保存当前草稿</button>
          </div>
        </footer>
        {saveAttempted && !data.title.trim() && <em>缺少商品标题</em>}
      </section>

      <section className="web-publish-section-heading">
        <span className="web-eyebrow">第二步</span>
        <h3>商品基础与类目属性</h3>
        <small>标题、类目、颜色和属性必须与图片及实物一致。</small>
      </section>
      <div className="web-product-form">
        <label>
          <span>末级类目</span>
          <select
            value={category?.categoryId || ""}
            onChange={(event) =>
              setCategory(
                categories.find(
                  (item) => String(item.categoryId) === event.target.value,
                ) || null,
              )
            }
          >
            <option value="">请选择</option>
            {categories.map((item) => (
              <option key={item.categoryId} value={item.categoryId}>
                {item.path.join(" / ")}
              </option>
            ))}
          </select>
        </label>
        <label><span>商家SKC货号</span><input value={data.supplierCode} onChange={(event) => updateSupplierCode(event.target.value)} /></label>
        {mainSaleFields.length > 0 && (
          <label>
            <span>SKC主销售属性{data.sizeTemplateColorText ? `（模板颜色：${data.sizeTemplateColorText}）` : ""}</span>
            <ConfirmedOptionPicker
              onConfirm={(selected) => {
                const [attributeId = "", valueId = ""] = String(selected[0] || "").split(":");
                setData((current) => ({
                  ...current,
                  skcSaleAttributeId: attributeId,
                  skcSaleAttributeValueId: valueId,
                }));
              }}
              options={mainSaleFields.flatMap((field) => field.values.map((value) => ({ id: `${field.id}:${value.id}`, label: `${field.name} / ${value.label}` })))}
              placeholder={data.sizeTemplateColorText ? `匹配“${data.sizeTemplateColorText}”到SHEIN颜色` : "请选择SHEIN主销售属性"}
              valueIds={selectedMainSale ? [selectedMainSale] : []}
            />
          </label>
        )}
        <label><span>计重形状</span><select value={data.shape} onChange={(event) => changeShape(event.target.value)}><option value="rectangle">矩形</option><option value="round">圆形</option></select></label>
      </div>

      <div className="web-publish-calculators">
        <div><label><span>每平方米供货价{currency ? `（${currency}）` : ""}</span><input inputMode="decimal" value={pricePerSquareMeter} onChange={(event) => setPricePerSquareMeter(event.target.value)} /></label><button className="web-secondary-button" onClick={applyPricePerSquareMeter} type="button">一键应用价格</button><small>矩形：长×宽；圆形按你的规则：直径×直径。</small></div>
        <div><label><span>每平方米克重（g）</span><input inputMode="decimal" value={data.gramsPerSquareMeter} onChange={(event) => update("gramsPerSquareMeter", event.target.value)} /></label><button className="web-secondary-button" onClick={applyGramsPerSquareMeter} type="button">一键应用克重</button><small>按成品面积换算产品重量（含包装）；包装表只匹配长宽高。</small></div>
        <div><label><span>统一库存</span><input inputMode="numeric" value={bulkInventory} onChange={(event) => setBulkInventory(event.target.value)} /></label><button className="web-secondary-button" onClick={applyBulkInventory} type="button">一键应用库存</button><small>只批量填写；每个SKU仍可单独修改。</small></div>
      </div>

      {requiredFields.length > 0 && (
        <div className="web-attribute-form">
          <h4>类目必填属性</h4>
          {requiredFields.map((field) => (
            <label className={saveAttempted && !(data.attributeValues?.[String(field.id)]?.valueIds || []).length && !String(data.attributeValues?.[String(field.id)]?.customValue || "").trim() ? "is-invalid" : ""} key={field.id}>
              <span>* {field.name}</span>
              <AttributeValueEditor
                field={field}
                value={data.attributeValues?.[String(field.id)]}
                onChange={(value) =>
                  setData((current) => ({
                    ...current,
                    attributeValues: {
                      ...current.attributeValues,
                      [String(field.id)]: value,
                    },
                  }))
                }
              />
            </label>
          ))}
        </div>
      )}

      {productFields.some((field) => !field.required) && (
        <details className="web-optional-attribute-form">
          <summary>补充选填属性（{productFields.filter((field) => !field.required).length}项）</summary>
          <div className="web-attribute-form">
            {productFields.filter((field) => !field.required).map((field) => (
              <label key={field.id}>
                <span>{field.name}</span>
                <AttributeValueEditor
                  field={field}
                  value={data.attributeValues?.[String(field.id)]}
                  onChange={(value) => setData((current) => ({ ...current, attributeValues: { ...current.attributeValues, [String(field.id)]: value } }))}
                />
              </label>
            ))}
          </div>
        </details>
      )}

      <section className="web-publish-data-section web-sku-sales-editor">
        <header>
          <div><span className="web-eyebrow">第三步</span><h3>SKU销售信息</h3><small>每个尺寸一行，只保留上品时需要频繁编辑的字段。</small></div>
          <span>{data.sizeRows.length}个SKU · {currency || "币种待同步"}</span>
        </header>
        <div className="web-publish-table-wrap">
          <div className="web-publish-table web-publish-table--sales">
            <div className="web-publish-table__head"><span>SHEIN尺寸</span><span>供货价</span><span>库存</span><span>件数</span><span>状态</span><span>SKU图</span><span /></div>
            {data.sizeRows.map((row, index) => (
              <div className="web-publish-table__row" key={row.id}>
                <div className="web-publish-table__size"><b>SKU {index + 1}</b><ConfirmedOptionPicker onConfirm={(selected) => selectSize(row, selected[0] || "")} options={sizeOptions.map((option) => ({ id: `${option.fieldId}:${option.id}`, label: `${option.fieldName} / ${option.label}` }))} placeholder={row.templateSizeText ? `匹配“${row.templateSizeText}”` : "选择SHEIN尺寸"} valueIds={row.sheinAttributeId && row.sheinAttributeValueId ? [`${row.sheinAttributeId}:${row.sheinAttributeValueId}`] : []} /></div>
                <label><span>供货价</span><input inputMode="decimal" value={row.costPrice} onChange={(event) => updateSizeRow(row.id, { costPrice: event.target.value })} /></label>
                <label><span>库存</span><input min="0" max="99999" type="number" value={row.inventoryNum} onChange={(event) => updateSizeRow(row.id, { inventoryNum: event.target.value })} /></label>
                <label><span>件数</span><input min="1" max="99" type="number" value={row.quantity || "1"} onChange={(event) => updateSizeRow(row.id, { quantity: event.target.value })} /></label>
                <label><span>状态</span><select value={row.mallState || "1"} onChange={(event) => updateSizeRow(row.id, { mallState: event.target.value })}><option value="1">上架</option><option value="0">不上架</option></select></label>
                <label className="web-sku-image-field"><span>SKU图</span>{row.imageAssetId ? <span className="web-sku-image-field__preview">{assetPreviewUrls[row.imageAssetId] ? <img alt="SKU预览图" src={assetPreviewUrls[row.imageAssetId]} /> : <ImagePlus size={20} />}<button onClick={() => removeDraftImage(row.imageAssetId, row.id)} type="button"><Trash2 size={13} /></button></span> : <span className="web-sku-image-field__upload"><Upload size={14} />上传<input accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(event) => chooseDraftImages(event, { rowId: row.id })} type="file" /></span>}</label>
                <button className="web-publish-table__delete" disabled={data.sizeRows.length === 1} onClick={() => update("sizeRows", data.sizeRows.filter((item) => item.id !== row.id))} title="删除SKU" type="button"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
        <button className="web-secondary-button" onClick={() => update("sizeRows", [...data.sizeRows, createWebSkuRow({ supplierCode: data.supplierCode, index: data.sizeRows.length, source: { shape: data.shape } })])} type="button"><Plus size={15} />添加一个SKU尺寸</button>
        {!sizeOptions.length && category && schema && <div className="web-alert"><AlertCircle size={17} /><span>当前类目接口没有返回可识别的尺寸销售属性，暂不能通过本地名称猜测。</span></div>}
      </section>

      <section className="web-publish-data-section web-supply-package-editor">
        <header><div><span className="web-eyebrow">第四步</span><h3>供应商与包装信息</h3><small>商家SKU、采购状态、包装体积和产品重量集中维护。</small></div></header>
        <div className="web-package-toolbar">
          <label className="web-secondary-button"><FileSpreadsheet size={15} />导入打包体积表<input accept=".xlsx" onChange={importPackaging} type="file" /></label>
          <select value={data.packagingMaterial || ""} onChange={(event) => update("packagingMaterial", event.target.value)}><option value="">选择材质工作表</option>{Object.keys(data.packagingWorkbook?.materials || {}).map((material) => <option key={material} value={material}>{material}</option>)}</select>
          <button className="web-secondary-button" onClick={resolvePackaging} type="button"><RefreshCw size={14} />匹配包装体积</button>
          <small>{data.packagingWorkbook?.fileName ? `已导入 ${data.packagingWorkbook.fileName}` : "上传新表会覆盖当前草稿中的旧包装表；重复尺寸按最后一行覆盖。"}</small>
        </div>
        <div className="web-publish-table-wrap">
          <div className="web-publish-table web-publish-table--supply">
            <div className="web-publish-table__head"><span>尺寸</span><span>商家SKU</span><span>采购状态</span><span>包装长</span><span>包装宽</span><span>包装高</span><span>产品重量</span></div>
            {data.sizeRows.map((row) => (
              <div className="web-publish-table__row" key={row.id}>
                <div className="web-publish-table__readonly"><b>{row.sheinLabel || row.templateSizeText || "待匹配"}</b><small className={`web-package-match--${row.packageMatch || "pending"}`}>{row.packageMatch === "matched" ? "包装表已匹配" : row.packageMatch === "manual" ? "人工填写" : row.packageMatch === "missing" ? "需手工补充" : "待匹配"}</small></div>
                <label><span>商家SKU</span><input value={row.supplierSku} onChange={(event) => updateSizeRow(row.id, { supplierSku: event.target.value })} /></label>
                <label><span>采购状态</span><select value={row.stopPurchase || "1"} onChange={(event) => updateSizeRow(row.id, { stopPurchase: event.target.value })}><option value="1">正常采购</option><option value="2">停止采购</option></select></label>
                <label><span>{dimensionsRequired && "*"}长(cm)</span><input inputMode="decimal" value={row.packageLengthCm} onChange={(event) => updateSizeRow(row.id, { packageLengthCm: event.target.value, packageMatch: "manual" })} /></label>
                <label><span>{dimensionsRequired && "*"}宽(cm)</span><input inputMode="decimal" value={row.packageWidthCm} onChange={(event) => updateSizeRow(row.id, { packageWidthCm: event.target.value, packageMatch: "manual" })} /></label>
                <label><span>{dimensionsRequired && "*"}高(cm)</span><input inputMode="decimal" value={row.packageHeightCm} onChange={(event) => updateSizeRow(row.id, { packageHeightCm: event.target.value, packageMatch: "manual" })} /></label>
                <label><span>{weightRequired && "*"}含包装(g)</span><input inputMode="decimal" value={row.weightGrams ?? ""} onChange={(event) => updateSizeRow(row.id, { weightGrams: event.target.value })} /></label>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="web-publish-data-section web-size-chart-editor">
        <header><div><span className="web-eyebrow">第五步</span><h3>商品尺码表</h3><small>这里仅填写SHEIN当前类目真实返回的尺码表字段。</small></div></header>
        <div className="web-size-chart-toolbar"><label><span>统一高度（cm）</span><input inputMode="decimal" value={bulkSizeHeight} onChange={(event) => setBulkSizeHeight(event.target.value)} /></label><button className="web-secondary-button" onClick={applyBulkSizeHeight} type="button">一键应用高度</button></div>
        {sizeAttributeFields.length ? (
          <div className="web-publish-table-wrap">
            <div className="web-publish-table web-publish-table--size-chart" style={{ "--size-field-count": sizeAttributeFields.length }}>
              <div className="web-publish-table__head"><span>尺寸</span>{sizeAttributeFields.map((field) => <span key={field.id}>{field.required && "*"}{field.name}</span>)}</div>
              {data.sizeRows.map((row) => <div className="web-publish-table__row" key={row.id}><div className="web-publish-table__readonly"><b>{row.sheinLabel || row.templateSizeText || "待匹配"}</b></div>{sizeAttributeFields.map((field) => <label key={field.id}><span>{field.name}</span><input inputMode="decimal" value={row.sizeAttributeValues?.[String(field.id)] || ""} onChange={(event) => updateSizeAttribute(row, field, event.target.value)} /></label>)}</div>)}
            </div>
          </div>
        ) : <div className="web-alert"><AlertCircle size={17} /><span>当前类目没有返回尺码表字段，无需填写；软件不会自行猜测。</span></div>}
      </section>

      <section className="web-publish-compliance-chain">
        <header>
          <div>
            <span className="web-eyebrow">发布后按SKC处理</span>
            <h3>合规衔接</h3>
          </div>
          <small>不在SKC生成前猜测或伪造平台要求</small>
        </header>
        <div>
          <article>
            <strong>欧代 / 制造商</strong>
            <span>
              {data.complianceTemplateId
                ? "已引用当前店铺的平台合规公司模板"
                : "可选择当前店铺合规信息模板"}
            </span>
          </article>
          <article>
            <strong>1630 / 1631</strong>
            <span>发布返回真实SKC后，再按SHEIN返回的证书要求逐个上传。</span>
          </article>
          <article>
            <strong>实拍标签图</strong>
            <span>通过SKC标签列表查询实际缺失项，只对缺失的SKC建立补充任务。</span>
          </article>
        </div>
      </section>

      <div className="web-risk-note">
        地毯尺寸必须在标题、属性和图片中保持一致；主图不要夸大房间比例、厚度、防滑或可水洗效果。
      </div>
      <div className="web-draft-blockers">
        <strong>{localBlockers.length ? `${localBlockers.length}个阻断项` : "本地字段完整"}</strong>
        {localBlockers.slice(0, 12).map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
      </div>
      <footer>
        <button className="web-primary-button" disabled={busy} onClick={save} type="button">
          {busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
          保存并预检全部SKU
        </button>
      </footer>
      <TailImageCropDialog
        item={imageCropQueue[0]}
        onCancel={cancelDraftCrop}
        onSave={saveCroppedDraftImage}
      />
    </section>
  );
}

function CompliancePanel({ store }) {
  const [skcs, setSkcs] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [activeSkc, setActiveSkc] = useState("");
  const [batchPreflight, setBatchPreflight] = useState(null);

  useEffect(() => {
    setRows([]);
    setSkcs("");
    setNotice("");
    setActiveSkc("");
    setBatchPreflight(null);
  }, [store?.id]);

  const submit = async (event) => {
    event.preventDefault();
    const skcNames = Array.from(
      new Set(
        skcs
          .split(/[\s,，;；]+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
    if (!skcNames.length) {
      setNotice("请输入至少一个SKC");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const result = await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/query`,
        {
          method: "POST",
          body: JSON.stringify({ skcNames }),
        },
      );
      setRows(result.rows || []);
      setActiveSkc((current) =>
        (result.rows || []).some((row) => row.skc === current)
          ? current
          : result.rows?.[0]?.skc || "",
      );
      if (result.failedSkcNames?.length) {
        setNotice(`${result.failedSkcNames.length} 个SKC查询失败，可稍后重试`);
      }
    } catch (error) {
      setRows([]);
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  const runBatchPreflight = async () => {
    if (!rows.length) {
      setNotice("请先查询需要处理的SKC");
      return;
    }
    setLoading(true);
    setNotice("");
    try {
      const draftResults = await Promise.all(
        rows.map((row) =>
          requestWebApi(
            `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/drafts/${encodeURIComponent(row.skc)}`,
          ),
        ),
      );
      const inputsBySkc = Object.fromEntries(
        rows.map((row, index) => [
          row.skc,
          draftResults[index].draft?.inputs || {},
        ]),
      );
      const result = await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/preflight`,
        {
          method: "POST",
          body: JSON.stringify({
            skcNames: rows.map((row) => row.skc),
            inputsBySkc,
          }),
        },
      );
      setBatchPreflight(result);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="web-content">
      <section className="web-page-intro">
        <div>
          <span className="web-eyebrow">真实合规要求</span>
          <h2>合规中心</h2>
          <p>一次最多查询20个SKC，GCC和产品标识符会归入“后台合规项”。</p>
        </div>
        <form className="web-compliance-query" onSubmit={submit}>
          <textarea
            aria-label="需要查询的SKC"
            placeholder="输入SKC，多个可用逗号或换行分隔"
            value={skcs}
            onChange={(event) => setSkcs(event.target.value)}
          />
          <button disabled={loading || !store} type="submit">
            {loading ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
            {loading ? "查询中" : "查询合规"}
          </button>
        </form>
      </section>

      {notice && (
        <div className="web-alert">
          <AlertCircle size={17} />
          <span>{notice}</span>
        </div>
      )}

      <section className="web-data-card">
        <div className="web-card__head">
          <div>
            <span className="web-eyebrow">批量处理</span>
            <h3>{rows.length} 个SKC</h3>
          </div>
          <button
            className="web-secondary-button"
            disabled={loading || !rows.length}
            onClick={runBatchPreflight}
            type="button"
          >
            <ClipboardCheck size={15} />
            批量预检
          </button>
        </div>
        {batchPreflight && (
          <div className="web-batch-preflight">
            <span>可提交 {batchPreflight.summary?.ready || 0}</span>
            <span>已合规 {batchPreflight.summary?.compliant || 0}</span>
            <span>阻断 {batchPreflight.summary?.blocked || 0}</span>
            <span>规则待同步 {batchPreflight.summary?.rulesPending || 0}</span>
            <strong>
              {batchPreflight.executable
                ? "整批预检通过"
                : "整批暂不可提交，请逐个打开“补资料”处理"}
            </strong>
          </div>
        )}
        <div className="web-table web-compliance-table">
          <div className="web-table__head">
            <span>SKC</span>
            <span>证书</span>
            <span>代理公司</span>
            <span>警告语</span>
            <span>后台合规项</span>
            <span>实拍图</span>
            <span>操作</span>
          </div>
          {rows.map((row) => (
            <div className="web-table__row" key={row.skc}>
              <span className="web-two-line">
                <strong>{row.name || row.skc}</strong>
                <small>{row.skc}</small>
              </span>
              <span>{row.certificate}</span>
              <span>{row.agency}</span>
              <span>{row.warning}</span>
              <span>{row.platformOnly}</span>
              <span>{row.bodyPhoto} / {row.packagePhoto}</span>
              <span>
                <button
                  className="web-secondary-button"
                  onClick={() => setActiveSkc(row.skc)}
                  type="button"
                >
                  补资料
                </button>
              </span>
            </div>
          ))}
          {!loading && rows.length === 0 && (
            <div className="web-empty">
              <ShieldCheck size={26} />
              <strong>输入SKC后查询合规状态</strong>
              <small>当前页面只读取，不会修改商品或上传文件。</small>
            </div>
          )}
          {loading && (
            <div className="web-table-loading">
              <LoaderCircle className="spin" size={20} />
              正在读取证书、公司、HGXXL和实拍图要求
            </div>
          )}
        </div>
      </section>
      {activeSkc && (
        <ComplianceEditor
          key={`${store?.id}-${activeSkc}`}
          onClose={() => setActiveSkc("")}
          skc={activeSkc}
          store={store}
        />
      )}
    </div>
  );
}

function complianceKey(requirement = {}) {
  return String(
    requirement.labelId != null
      ? `${requirement.labelId}:${requirement.labelGroup || ""}`
      : requirement.certificateTypeCode || requirement.certificateTypeId || "",
  );
}

function isPerSkcCertificate(requirement = {}) {
  const identity = [
    requirement.certificateTypeCode,
    requirement.certificateTypeName,
    requirement.certificateType,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    identity.includes("1630") ||
    identity.includes("1631") ||
    identity.includes("smallcarpet") ||
    identity.includes("largecarpet")
  );
}

function isReusableEuPhoto(requirement = {}) {
  const name = String(requirement.labelName || "").toLowerCase();
  return (
    Number(requirement.labelId) === 11 ||
    name.includes("欧代") ||
    name.includes("欧盟责任人")
  );
}

function replaceAssignment(values, requirement, next) {
  const key = complianceKey(requirement);
  return [
    ...(values || []).filter((item) => complianceKey(item) !== key),
    ...(next ? [next] : []),
  ];
}

function ComplianceEditor({ store, skc, onClose }) {
  const emptyInputs = {
    certificates: [],
    agencies: [],
    warnings: [],
    photos: [],
  };
  const [row, setRow] = useState(null);
  const [bundle, setBundle] = useState(null);
  const [inputs, setInputs] = useState(emptyInputs);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [preflight, setPreflight] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setNotice("");
      try {
        const [rules, draftResult, templateResult] = await Promise.all([
          requestWebApi(
            `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/rules`,
            {
              method: "POST",
              body: JSON.stringify({ skc }),
            },
          ),
          requestWebApi(
            `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/drafts/${encodeURIComponent(skc)}`,
          ),
          requestWebApi(
            `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/templates`,
          ),
        ]);
        setRow(rules.row);
        setBundle(rules.bundle);
        setTemplates(templateResult.templates || []);
        if (draftResult.draft) {
          setInputs({ ...emptyInputs, ...(draftResult.draft.inputs || {}) });
          setPreflight(draftResult.draft.preflight || null);
          setSelectedTemplateId(draftResult.draft.templateId || "");
        }
      } catch (error) {
        setNotice(error.message);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [store.id, skc]);

  const runPreflight = async (nextInputs = inputs) => {
    const selectedTemplate = templates.find(
      (template) => template.id === selectedTemplateId,
    );
    const result = await requestWebApi(
      `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/preflight`,
      {
        method: "POST",
        body: JSON.stringify({
          skcNames: [skc],
          inputsBySkc: { [skc]: nextInputs },
          template: selectedTemplate || null,
        }),
      },
    );
    setPreflight(result);
    return result;
  };

  const saveDraft = async () => {
    setBusyKey("save");
    setNotice("");
    try {
      const checked = await runPreflight();
      const plan = checked.plans?.[0] || {};
      await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/drafts/${encodeURIComponent(skc)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            templateId: selectedTemplateId || null,
            requirementSnapshot: { row, bundle, fetchedAt: bundle?.fetchedAt },
            inputs,
            preflight: checked,
            status:
              plan.status === "ready"
                ? "ready"
                : plan.status === "waiting_review"
                  ? "waiting_review"
                  : plan.status === "blocked"
                    ? "blocked"
                    : "draft",
          }),
        },
      );
      setNotice("草稿和预检结果已保存，尚未向SHEIN提交。");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyKey("");
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      setNotice("请先填写通用模板名称");
      return;
    }
    setBusyKey("template");
    try {
      const result = await requestWebApi(
        `/v1/web/stores/${encodeURIComponent(store.id)}/compliance/templates`,
        {
          method: "POST",
          body: JSON.stringify({
            name: templateName.trim(),
            referenceSkc: skc,
            defaults: inputs,
            ruleSnapshot: { row, bundle },
            ruleSnapshotAt: bundle?.fetchedAt,
          }),
        },
      );
      setTemplates((current) => [
        result.template,
        ...current.filter((item) => item.id !== result.template.id),
      ]);
      setSelectedTemplateId(result.template.id);
      setNotice(
        "通用模板已保存；1630/1631和非欧代实拍图已自动排除。",
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyKey("");
    }
  };

  const applyTemplate = (templateId) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setInputs((current) => ({
      certificates: [
        ...(template.defaults?.certificates || []),
        ...(current.certificates || []).filter(isPerSkcCertificate),
      ],
      agencies: template.defaults?.agencies || [],
      warnings: template.defaults?.warnings || [],
      photos: [
        ...(template.defaults?.photos || []),
        ...(current.photos || []).filter(
          (photo) => photo.templateReusable !== true,
        ),
      ],
    }));
    setNotice("已套用通用资料；单SKC资料保持不变。");
  };

  const uploadCertificate = async (requirement, file) => {
    if (!file) return;
    const key = `cert:${complianceKey(requirement)}`;
    setBusyKey(key);
    try {
      const asset = await uploadWebMediaFile({
        storeId: store.id,
        file,
        purpose: "compliance_evidence",
      });
      setInputs((current) => ({
        ...current,
        certificates: replaceAssignment(
          current.certificates,
          requirement,
          {
            skc,
            certificateTypeCode: requirement.certificateTypeCode,
            certificateTypeId: requirement.certificateTypeId,
            certificateTypeName: requirement.certificateTypeName,
            schema: (bundle?.certificateSchemas || []).find(
              (schema) =>
                String(schema.certificateTypeId) ===
                String(requirement.certificateTypeId),
            ),
            files: [
              {
                localAssetId: asset.id,
                fileName: file.name,
                mimeType: file.type,
                size: file.size,
              },
            ],
          },
        ),
      }));
      setNotice(
        "文件已安全暂存；接口启用后还需直传SHEIN证书文件接口。",
      );
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyKey("");
    }
  };

  const uploadPhoto = async (requirement, file) => {
    if (!file) return;
    const key = `photo:${complianceKey(requirement)}`;
    setBusyKey(key);
    try {
      const asset = await uploadWebMediaFile({
        storeId: store.id,
        file,
        purpose: "compliance_evidence",
      });
      setInputs((current) => ({
        ...current,
        photos: replaceAssignment(current.photos, requirement, {
          labelId: requirement.labelId,
          labelGroup: String(requirement.labelGroup || ""),
          labelName: requirement.labelName,
          templateReusable: isReusableEuPhoto(requirement),
          localAssetRef: `media:${asset.id}`,
          localAssetId: asset.id,
          fileName: file.name,
          mimeType: file.type,
          size: file.size,
          width: asset.width,
          height: asset.height,
        }),
      }));
      setNotice("实拍图已暂存并写入当前SKC草稿。");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusyKey("");
    }
  };

  const updateWarningValue = (
    requirement,
    rules,
    fieldCode,
    valueId,
    checked,
  ) => {
    setInputs((current) => {
      const key = complianceKey(requirement);
      const existing = (current.warnings || []).find(
        (item) => complianceKey(item) === key,
      );
      const currentIds = (
        existing?.selectedByField?.[fieldCode] || []
      ).map(String);
      const nextIds = checked
        ? Array.from(new Set([...currentIds, String(valueId)]))
        : currentIds.filter((id) => id !== String(valueId));
      return {
        ...current,
        warnings: replaceAssignment(
          current.warnings,
          requirement,
          {
            certificateTypeCode: requirement.certificateTypeCode,
            certificateTypeId: requirement.certificateTypeId,
            certificateTypeName: requirement.certificateTypeName,
            rules,
            selectedByField: {
              ...(existing?.selectedByField || {}),
              [fieldCode]: nextIds,
            },
          },
        ),
      };
    });
  };

  if (loading) {
    return (
      <section className="web-compliance-editor web-table-loading">
        <LoaderCircle className="spin" size={20} />
        正在读取 {skc} 的动态合规规则
      </section>
    );
  }

  const requirements = bundle?.requirements || {};
  const plan = preflight?.plans?.[0];
  return (
    <section className="web-compliance-editor">
      <header>
        <div>
          <span className="web-eyebrow">单个商品补资料</span>
          <h3>{skc}</h3>
          <p>所有字段来自当前店铺实时规则；保存草稿不会向SHEIN写入。</p>
        </div>
        <button aria-label="关闭补资料" onClick={onClose} type="button">
          <X size={18} />
        </button>
      </header>

      <div className="web-compliance-template-bar">
        <label>
          <span>套用通用模板</span>
          <select
            value={selectedTemplateId}
            onChange={(event) => applyTemplate(event.target.value)}
          >
            <option value="">不套用</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} · v{template.version}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>保存当前通用资料</span>
          <input
            placeholder="例如：欧盟地毯通用合规"
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
          />
        </label>
        <button
          disabled={Boolean(busyKey)}
          onClick={saveTemplate}
          type="button"
        >
          保存模板
        </button>
      </div>

      {notice && (
        <div className="web-alert">
          <AlertCircle size={17} />
          <span>{notice}</span>
        </div>
      )}

      <div className="web-compliance-sections">
        <article>
          <h4>证书与1630/1631</h4>
          {(requirements.certificates || []).map((requirement) => {
            const key = complianceKey(requirement);
            const assignment = (inputs.certificates || []).find(
              (item) => complianceKey(item) === key,
            );
            const perSkc = isPerSkcCertificate(requirement);
            const options = (bundle?.certificates || []).filter(
              (certificate) =>
                certificate.certificateTypeCode ===
                  requirement.certificateTypeCode &&
                Number(certificate.status) === 2,
            );
            return (
              <div className="web-compliance-field" key={key}>
                <span>
                  <strong>{requirement.certificateTypeName}</strong>
                  <small>{perSkc ? "每个SKC必须单独上传" : "可选生效证书池记录"}</small>
                </span>
                {perSkc ? (
                  <label className="web-mini-upload">
                    {busyKey === `cert:${key}` ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Upload size={15} />
                    )}
                    {assignment?.files?.[0]?.fileName || "上传PDF/图片"}
                    <input
                      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                      disabled={Boolean(busyKey)}
                      onChange={(event) => {
                        uploadCertificate(requirement, event.target.files?.[0]);
                        event.target.value = "";
                      }}
                      type="file"
                    />
                  </label>
                ) : (
                  <select
                    value={assignment?.poolSn || ""}
                    onChange={(event) => {
                      const selected = options.find(
                        (item) => String(item.poolSn) === event.target.value,
                      );
                      setInputs((current) => ({
                        ...current,
                        certificates: replaceAssignment(
                          current.certificates,
                          requirement,
                          selected
                            ? {
                                ...requirement,
                                poolSn: selected.poolSn,
                                status: selected.status,
                                certificateDimension:
                                  selected.certificateDimension,
                              }
                            : null,
                        ),
                      }));
                    }}
                  >
                    <option value="">未选择</option>
                    {options.map((option) => (
                      <option key={option.poolSn} value={option.poolSn}>
                        {option.fileList?.[0]?.fileName || option.poolSn}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </article>

        <article>
          <h4>代理公司 / 欧代</h4>
          {(requirements.agencies || []).map((requirement) => {
            const key = complianceKey(requirement);
            const assignment = (inputs.agencies || []).find(
              (item) => complianceKey(item) === key,
            );
            return (
              <div className="web-compliance-field" key={key}>
                <span>
                  <strong>{requirement.certificateTypeName}</strong>
                  <small>仅显示SHEIN返回且当前可绑定的记录</small>
                </span>
                <select
                  value={assignment?.agencyId || ""}
                  onChange={(event) => {
                    const selected = (bundle?.bindableAgencies || []).find(
                      (item) =>
                        String(item.agencyId) === event.target.value,
                    );
                    setInputs((current) => ({
                      ...current,
                      agencies: replaceAssignment(
                        current.agencies,
                        requirement,
                        selected
                          ? { ...requirement, ...selected }
                          : null,
                      ),
                    }));
                  }}
                >
                  <option value="">未选择</option>
                  {(bundle?.bindableAgencies || []).map((agency) => (
                    <option key={agency.agencyId} value={agency.agencyId}>
                      {agency.agencyName} · 类型{agency.agencyType}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </article>

        <article>
          <h4>合规实拍图</h4>
          {[
            ...(requirements.bodyPhotos || []),
            ...(requirements.packagePhotos || []),
          ].map((requirement) => {
            const key = complianceKey(requirement);
            const assignment = (inputs.photos || []).find(
              (item) => complianceKey(item) === key,
            );
            return (
              <div className="web-compliance-field" key={key}>
                <span>
                  <strong>{requirement.labelName}</strong>
                  <small>
                    {isReusableEuPhoto(requirement)
                      ? "欧代实拍图，可进入通用模板"
                      : "当前SKC单独资料"}
                  </small>
                </span>
                <label className="web-mini-upload">
                  {busyKey === `photo:${key}` ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <Upload size={15} />
                  )}
                  {assignment?.fileName || "选择实拍图"}
                  <input
                    accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                    disabled={Boolean(busyKey)}
                    onChange={(event) => {
                      uploadPhoto(requirement, event.target.files?.[0]);
                      event.target.value = "";
                    }}
                    type="file"
                  />
                </label>
              </div>
            );
          })}
        </article>

        <article>
          <h4>手动警告语</h4>
          {(requirements.warnings || []).length ? (
            requirements.warnings.map((requirement) => {
              const rules = (bundle?.warningRules || []).find(
                (item) =>
                  item.certificateTypeCode ===
                  requirement.certificateTypeCode,
              );
              const assignment = (inputs.warnings || []).find(
                (item) =>
                  complianceKey(item) === complianceKey(requirement),
              );
              return (
                <div
                  className="web-warning-editor"
                  key={complianceKey(requirement)}
                >
                  <strong>{requirement.certificateTypeName}</strong>
                  {(rules?.presetInfo?.presetFields || [])
                    .filter((field) => Number(field.isEnabled ?? 1) === 1)
                    .map((field) => (
                      <fieldset key={field.fieldCode}>
                        <legend>{field.fieldName}</legend>
                        <div>
                          {(field.presetFieldValues || [])
                            .filter(
                              (value) =>
                                Number(value.isEnabled ?? 1) === 1,
                            )
                            .map((value) => (
                              <label key={value.fieldValueId}>
                                <input
                                  checked={(
                                    assignment?.selectedByField?.[
                                      field.fieldCode
                                    ] || []
                                  )
                                    .map(String)
                                    .includes(String(value.fieldValueId))}
                                  onChange={(event) =>
                                    updateWarningValue(
                                      requirement,
                                      rules,
                                      field.fieldCode,
                                      value.fieldValueId,
                                      event.target.checked,
                                    )
                                  }
                                  type="checkbox"
                                />
                                <span>{value.fieldValue}</span>
                              </label>
                            ))}
                        </div>
                      </fieldset>
                    ))}
                  {!rules && <small>当前规则包未返回可填写字段。</small>}
                </div>
              );
            })
          ) : (
            <small>当前SKC没有需要人工填写的警告语。</small>
          )}
        </article>

        <article className="web-compliance-platform-only">
          <h4>GCC与产品标识符</h4>
          {(requirements.unsupported || []).length ? (
            requirements.unsupported.map((requirement) => (
              <div key={complianceKey(requirement)}>
                <ShieldCheck size={16} />
                <span>
                  <strong>{requirement.certificateTypeName}</strong>
                  <small>保留在预检阻断项，当前必须去SHEIN合规后台处理。</small>
                </span>
              </div>
            ))
          ) : (
            <small>当前SKC实时响应没有返回后台专属合规项。</small>
          )}
        </article>
      </div>

      {plan && (
        <div className={`web-preflight web-preflight--${plan.status}`}>
          <strong>
            预检：{plan.status} · {plan.counts?.blockers || 0}个阻断
          </strong>
          {(plan.blockers || []).slice(0, 6).map((blocker) => (
            <span key={`${blocker.code}-${blocker.requirementKey || ""}`}>
              {blocker.message}
            </span>
          ))}
        </div>
      )}

      <footer>
        <button
          className="web-secondary-button"
          disabled={Boolean(busyKey)}
          onClick={() => runPreflight().catch((error) => setNotice(error.message))}
          type="button"
        >
          提交前预检
        </button>
        <button
          className="web-primary-button"
          disabled={Boolean(busyKey)}
          onClick={saveDraft}
          type="button"
        >
          {busyKey === "save" ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
          保存草稿
        </button>
      </footer>
    </section>
  );
}

function readImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
      URL.revokeObjectURL(url);
    };
    image.onerror = () => {
      resolve({ width: null, height: null });
      URL.revokeObjectURL(url);
    };
    image.src = url;
  });
}

function Workspace({
  session,
  stores,
  activeStoreId,
  onStore,
  onLogout,
  onStoresReload,
}) {
  const [activePage, setActivePage] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("page");
    return navigation.some((item) => item.id === requested && item.ready)
      ? requested
      : navigation[0].id;
  });
  const [mobileNav, setMobileNav] = useState(false);
  const availableNavigation = useMemo(
    () => navigation.filter((item) =>
      (!item.adminOnly || ["owner", "admin"].includes(session.user.role)) &&
      (!item.ownerOnly || session.user.role === "owner"),
    ),
    [session.user.role],
  );
  const sheinStores = useMemo(
    () => stores.filter(isAuthorizedSheinStore),
    [stores],
  );
  const activeStore = sheinStores.find((store) => store.id === activeStoreId) || sheinStores[0] || null;
  const activeCount = sheinStores.filter((store) => store.status === "active").length;
  const attentionCount = sheinStores.length - activeCount;
  const initials = (
    session.user.displayName ||
    session.user.email ||
    "用户"
  ).slice(0, 2).toUpperCase();

  const selectPage = (item) => {
    if (!item.ready) return;
    setActivePage(item.id);
    setMobileNav(false);
  };

  return (
    <div className="web-shell">
      <button
        aria-label="关闭导航"
        className={`web-shell__backdrop ${mobileNav ? "is-open" : ""}`}
        onClick={() => setMobileNav(false)}
        type="button"
      />
      <aside className={`web-sidebar ${mobileNav ? "is-open" : ""}`}>
        <div className="web-brand">
          <span className="web-brand__mark">S</span>
          <span>
            <strong>全托管运营助手</strong>
            <small>网页协作版</small>
          </span>
          <button aria-label="关闭导航" onClick={() => setMobileNav(false)} type="button">
            <X size={18} />
          </button>
        </div>
        <nav>
          {availableNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <div className={`web-sidebar__nav-item ${item.section === "创作工具" && availableNavigation.findIndex((entry) => entry.section === item.section) === availableNavigation.indexOf(item) ? "is-creative-start" : ""}`} key={item.id}>
                {(item.section && availableNavigation.findIndex((entry) => entry.section === item.section) === availableNavigation.indexOf(item)) && (
                  <span className="web-sidebar__label">{item.section}</span>
                )}
                <button
                  className={`${activePage === item.id ? "is-active" : ""} ${!item.ready ? "is-planned" : ""}`}
                  disabled={!item.ready}
                  onClick={() => selectPage(item)}
                  type="button"
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                  {!item.ready && <small>逐步接入</small>}
                </button>
              </div>
            );
          })}
        </nav>
        <div className="web-sidebar__workspace">
          <span>{initials}</span>
          <div>
            <strong>{session.user.displayName || session.user.email}</strong>
            <small>{roleLabels[session.user.role] || session.user.role}</small>
          </div>
          <button aria-label="退出登录" onClick={onLogout} type="button">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <main className="web-main">
        <header className="web-header">
          <button
            aria-label="打开导航"
            className="web-header__menu"
            onClick={() => setMobileNav(true)}
            type="button"
          >
            <Menu size={20} />
          </button>
          <div>
            <span className="web-eyebrow">{session.tenant.name}</span>
            <h1>{availableNavigation.find((item) => item.id === activePage)?.label}</h1>
          </div>
          <div className="web-header__actions">
            <label className="web-store-picker">
              <Store size={16} />
              <select
                aria-label="当前店铺"
                value={activeStore?.id || ""}
                onChange={(event) => onStore(event.target.value)}
              >
                {!sheinStores.length && <option value="">尚未授权SHEIN店铺</option>}
                {sheinStores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.label || `SHEIN 店铺 ${store.supplierId || ""}`}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
            <button aria-label="通知" className="web-icon-button" type="button">
              <Bell size={18} />
            </button>
          </div>
        </header>

        {activePage === "overview" ? (
          <div className="web-content">
            <section className="web-hero">
              <div>
                <span className="web-eyebrow">网页版基础已连接</span>
                <h2>团队账号和店铺权限，已经进入云端。</h2>
                <p>
                  当前阶段先确认成员只能看到自己的工作空间和店铺。
                  商品、合规和发布模块将沿用已经验证过的业务规则逐项迁入。
                </p>
              </div>
              <div className="web-hero__signal">
                <span><ShieldCheck size={20} /></span>
                <strong>安全会话</strong>
                <small>HttpOnly · SameSite · 服务端角色校验</small>
              </div>
            </section>

            <section className="web-kpis">
              <article>
                <span>已授权店铺</span>
                <strong>{sheinStores.length}</strong>
                <small>当前成员可访问</small>
              </article>
              <article>
                <span>正常连接</span>
                <strong>{activeCount}</strong>
                <small>可进入后续同步任务</small>
              </article>
              <article>
                <span>需要关注</span>
                <strong>{attentionCount}</strong>
                <small>重新授权或停用</small>
              </article>
              <article>
                <span>当前角色</span>
                <strong>{roleLabels[session.user.role] || session.user.role}</strong>
                <small>{session.user.email}</small>
              </article>
            </section>

            <section className="web-grid">
              <article className="web-card web-card--stores">
                <div className="web-card__head">
                  <div>
                    <span className="web-eyebrow">店铺权限</span>
                    <h3>当前账号可访问的店铺</h3>
                  </div>
                  <span>{sheinStores.length} 家</span>
                </div>
                {sheinStores.length ? (
                  <div className="web-store-list">
                    {sheinStores.map((store) => (
                      <button
                        className={store.id === activeStore?.id ? "is-active" : ""}
                        key={store.id}
                        onClick={() => onStore(store.id)}
                        type="button"
                      >
                        <span className="web-store-list__mark">
                          {(store.label || "SH").replace(/\s+/g, "").slice(0, 2)}
                        </span>
                        <span>
                          <strong>{store.label || `SHEIN 店铺 ${store.supplierId || ""}`}</strong>
                          <small>
                            {store.businessMode || "全托管"}
                            {store.supplierId ? ` · Supplier ${store.supplierId}` : ""}
                          </small>
                        </span>
                        <StoreStatus value={store.status} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="web-empty">
                    <Store size={26} />
                    <strong>当前账号还没有店铺权限</strong>
                    <small>请让管理员分配店铺或完成 SHEIN 授权。</small>
                  </div>
                )}
              </article>

              <article className="web-card web-card--roadmap">
                <div className="web-card__head">
                  <div>
                    <span className="web-eyebrow">迁移顺序</span>
                    <h3>纯网页版本进度</h3>
                  </div>
                </div>
                <ol>
                  <li className="is-done">
                    <span>1</span>
                    <div><strong>网页登录和会话</strong><small>账号、角色、租户隔离</small></div>
                  </li>
                  <li className="is-done">
                    <span>2</span>
                    <div><strong>商品与合规云端接口</strong><small>按店铺授权访问</small></div>
                  </li>
                  <li className="is-current">
                    <span>3</span>
                    <div><strong>对象存储与网页图片</strong><small>直传、校验和自动清理</small></div>
                  </li>
                  <li>
                    <span>4</span>
                    <div><strong>批量发布与审计</strong><small>确认、执行、回读</small></div>
                  </li>
                </ol>
              </article>
            </section>
          </div>
        ) : activePage === "products" ? (
          <ProductsPanel store={activeStore} />
        ) : activePage === "compliance" ? (
          <CompliancePanel store={activeStore} />
        ) : (
          <section className="web-placeholder">
            {(() => {
              const item = navigation.find((entry) => entry.id === activePage);
              const Icon = item?.icon || LayoutDashboard;
              return <Icon size={30} />;
            })()}
            <span className="web-eyebrow">正在迁入网页版</span>
            <h2>{navigation.find((item) => item.id === activePage)?.label}</h2>
            <p>此模块会复用桌面版已经验证的 SHEIN 字段和安全预检，不会重写业务规则。</p>
          </section>
        )}
      </main>
    </div>
  );
}

export default function WebApp() {
  const [session, setSession] = useState(null);
  const [stores, setStores] = useState([]);
  const [activeStoreId, setActiveStoreId] = useState("");
  const [status, setStatus] = useState("loading");

  const activeStore = useMemo(
    () => {
      const sheinStores = stores.filter(isAuthorizedSheinStore);
      return sheinStores.find((store) => store.id === activeStoreId) || sheinStores[0] || null;
    },
    [stores, activeStoreId],
  );

  const reloadStores = async () => {
    const result = await requestWebApi("/v1/web/stores");
    const nextStores = result.stores || [];
    const nextSheinStores = nextStores.filter(isAuthorizedSheinStore);
    setStores(nextStores);
    setActiveStoreId((current) =>
      nextSheinStores.some((store) => store.id === current)
        ? current
        : nextSheinStores[0]?.id || "",
    );
    return nextStores;
  };

  const loadWorkspace = async (knownSession = null) => {
    setStatus("loading");
    try {
      const [currentSession, storeResult] = await Promise.all([
        knownSession ? Promise.resolve(knownSession) : requestWebApi("/v1/web/session"),
        requestWebApi("/v1/web/stores"),
      ]);
      setSession(currentSession);
      const nextStores = storeResult.stores || [];
      const nextSheinStores = nextStores.filter(isAuthorizedSheinStore);
      setStores(nextStores);
      setActiveStoreId((current) =>
        nextSheinStores.some((store) => store.id === current)
          ? current
          : nextSheinStores[0]?.id || "",
      );
      setStatus("authenticated");
    } catch (error) {
      if (error.status === 401) {
        setSession(null);
        setStores([]);
        setStatus("anonymous");
        return;
      }
      setStatus("unavailable");
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  const logout = async () => {
    try {
      await requestWebApi("/v1/web/logout", { method: "POST" });
    } finally {
      setSession(null);
      setStores([]);
      setStatus("anonymous");
    }
  };

  if (status === "loading") {
    return (
      <main className="web-boot">
        <span className="web-brand__mark">S</span>
        <LoaderCircle className="spin" size={24} />
        <strong>正在进入运营工作台</strong>
      </main>
    );
  }

  if (status === "unavailable") {
    return (
      <main className="web-boot web-boot--error">
        <ShieldCheck size={30} />
        <strong>网页服务暂时不可用</strong>
        <small>请稍后刷新，或联系管理员检查云端服务。</small>
        <button onClick={() => loadWorkspace()} type="button">重新连接</button>
      </main>
    );
  }

  if (!session) {
    return <LoginScreen onAuthenticated={loadWorkspace} />;
  }

  return (
    <Workspace
      activeStoreId={activeStore?.id || ""}
      onLogout={logout}
      onStore={setActiveStoreId}
      onStoresReload={reloadStores}
      session={session}
      stores={stores}
    />
  );
}
