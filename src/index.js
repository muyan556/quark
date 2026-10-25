import request from "superagent";

// ==================== 常量配置 ====================
const QUARK_API_BASE = "https://uop.quark.cn";
const DRIVE_API_BASE = "https://drive-pc.quark.cn";
const CLIENT_ID = "532";
const VERSION = "1.2";
const QUARK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.20 Chrome/100.0.4896.160 Electron/18.3.5.4-b478491100 Safari/537.36 Channel/pckk_other_ch";

const STORAGE_COOKIE_KEY = "quark_full_cookie";
const TEMP_FOLDER_NAME = "GopeedTemp";

// ==================== 工具与 Cookie 管理 ====================

function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 合并旧 Cookie 与响应头下发的新 Set-Cookie（确保 __puus 实时更新不丢失）
 */
function mergeCookies(oldCookie = "", setCookieHeader) {
  const cookieMap = new Map();

  if (oldCookie) {
    oldCookie.split(";").forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx > -1) {
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k) cookieMap.set(k, v);
      }
    });
  }

  if (setCookieHeader) {
    const rawList = Array.isArray(setCookieHeader)
      ? setCookieHeader
      : String(setCookieHeader).split(/,(?=\s*[a-zA-Z0-9_-]+=)/);

    rawList.forEach((item) => {
      const firstPart = item.split(";")[0].trim();
      const idx = firstPart.indexOf("=");
      if (idx > -1) {
        const k = firstPart.slice(0, idx).trim();
        const v = firstPart.slice(idx + 1).trim();
        if (k && v && v !== "deleted" && v !== '""') {
          cookieMap.set(k, v);
        }
      }
    });
  }

  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * 统一封装的 SuperAgent 请求函数（带 Set-Cookie 自动拦截与持久化）
 */
async function quarkRequest(method, url, { query, data, cookie } = {}) {
  let currentCookie =
    cookie ||
    gopeed.storage.get(STORAGE_COOKIE_KEY) ||
    (gopeed.settings?.cookie || "").trim();

  const req = request(method, url)
    .set("User-Agent", QUARK_UA)
    .set("Referer", "https://pan.quark.cn/")
    .set("Origin", "https://pan.quark.cn")
    .set("Accept", "application/json, text/plain, */*");

  if (currentCookie) {
    req.set("Cookie", currentCookie);
  }
  if (query) {
    req.query({ pr: "ucpro", fr: "pc", ...query });
  }
  if (data) {
    req.set("Content-Type", "application/json").send(data);
  }

  const resp = await req;

  // 自动捕获并合并新的 Set-Cookie（依赖于 superagent@9.0.2.patch 补丁）
  const setCookie = resp.headers?.["set-cookie"];
  if (setCookie) {
    const updatedCookie = mergeCookies(currentCookie, setCookie);
    if (updatedCookie !== currentCookie) {
      currentCookie = updatedCookie;
      gopeed.storage.set(STORAGE_COOKIE_KEY, updatedCookie);
    }
  }

  let body = resp.body;
  if (!body || Object.keys(body).length === 0) {
    try {
      body = JSON.parse(resp.text || "{}");
    } catch (_) {
      body = {};
    }
  }

  return { body, cookie: currentCookie, headers: resp.headers };
}

// ==================== 扫码登录模块 ====================

/**
 * 唤起 Gopeed 内置 WebView 展示二维码，并通过纯接口轮询获取包含 __puus 的完整 Cookie
 */
async function loginByQRCode() {
  const requestId = uuidv4();

  // 1. 获取二维码 Token
  const tokenRes = await quarkRequest(
    "GET",
    `${QUARK_API_BASE}/cas/ajax/getTokenForQrcodeLogin`,
    {
      query: { client_id: CLIENT_ID, v: VERSION, request_id: requestId },
    }
  );

  if (tokenRes.body?.status !== 2000000) {
    throw new Error("获取夸克扫码 Token 失败: " + (tokenRes.body?.message || "网络错误"));
  }

  const token = tokenRes.body.data.members.token;
  const qrContentUrl = `https://b.quark.cn/apps/DuJrlezmS/routes/EATJRLSvv?uc_param_str=dsdnfrpfbivesscpgimibtbmnijblauputogpintnwktprchmt&token=${token}&client_id=532&ssb=weblogin&uc_biz_str=S%3Acustom%7COPT%3ASAREA%400%7COPT%3AIMMERSIVE%401%7COPT%3ABACK_BTN_STYLE%400`;

  // 2. 打开内置 WebView 窗口展示二维码
  const page = await gopeed.runtime.webview.open({
    headless: false,
    title: "夸克网盘扫码登录 - Gopeed",
    width: 440,
    height: 540,
    userAgent: QUARK_UA,
  });

  try {
    const fallbackQrImg = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
      qrContentUrl
    )}`;

    const html = `
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
        <meta charset="UTF-8">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif; }
          body { background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); height: 100vh; display: flex; justify-content: center; align-items: center; padding: 16px; }
          .container { background: white; border-radius: 16px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); width: 100%; max-width: 380px; overflow: hidden; text-align: center; }
          .header { background: linear-gradient(90deg, #1976D2 0%, #2196F3 100%); color: white; padding: 20px; }
          .header h1 { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
          .header p { font-size: 13px; opacity: 0.9; }
          .content { padding: 24px; display: flex; flex-direction: column; align-items: center; }
          #qrcode { padding: 14px; border: 1px solid #e0e0e0; border-radius: 12px; margin-bottom: 16px; min-height: 228px; display: flex; align-items: center; justify-content: center; }
          .status { font-size: 14px; font-weight: 500; color: #FF9800; line-height: 1.6; }
          .status.success { color: #4CAF50; }
          .status.error { color: #F44336; }
          .countdown { font-weight: bold; color: #2196F3; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>夸克网盘扫码登录</h1>
            <p>请使用夸克 App 扫描二维码登录</p>
          </div>
          <div class="content">
            <div id="qrcode">
              <img src="${fallbackQrImg}" width="200" height="200" alt="二维码加载中..." />
            </div>
            <div class="status" id="status">
              请使用夸克 App 扫描二维码<br>
              <span class="countdown">剩余时间: 3分00秒</span>
            </div>
          </div>
        </div>
        <script>
          if (window.QRCode) {
            const box = document.getElementById("qrcode");
            box.innerHTML = "";
            new QRCode(box, {
              text: ${JSON.stringify(qrContentUrl)},
              width: 200,
              height: 200,
              colorDark: "#000000",
              colorLight: "#ffffff",
              correctLevel: QRCode.CorrectLevel.H
            });
          }
        </script>
      </body>
      </html>
    `;

    await page.navigate("about:blank");
    await page.execute((rawHtml) => {
      document.open();
      document.write(rawHtml);
      document.close();
    }, html);

    // 3. 轮询扫码状态（每 3 秒一次，最多 60 次）
    const maxPollingCount = 60;
    for (let count = 1; count <= maxPollingCount; count++) {
      await new Promise((r) => setTimeout(r, 3000));

      const remainSec = Math.max(0, 180 - count * 3);
      const min = Math.floor(remainSec / 60);
      const sec = remainSec % 60;

      await page.execute(
        (c, max, m, s) => {
          const el = document.getElementById("status");
          if (el) {
            el.innerHTML = `等待扫码确认 (${c}/${max})...<br><span class="countdown">剩余时间: ${m}分${s}秒</span>`;
          }
        },
        count,
        maxPollingCount,
        min,
        sec
      );

      const pollRes = await quarkRequest(
        "GET",
        `${QUARK_API_BASE}/cas/ajax/getServiceTicketByQrcodeToken`,
        {
          query: {
            client_id: CLIENT_ID,
            v: VERSION,
            token: token,
            request_id: requestId,
          },
          cookie: tokenRes.cookie,
        }
      );

      if (pollRes.body?.status === 2000000) {
        const serviceTicket = pollRes.body.data.members.service_ticket;

        await page.execute(() => {
          const el = document.getElementById("status");
          if (el) {
            el.className = "status success";
            el.innerText = "扫码成功！正在激活并保存 Cookie...";
          }
        });

        // 第一级激活：调用 /account/info 获取基础 Cookie
        const infoRes = await quarkRequest("GET", "https://pan.quark.cn/account/info", {
          query: { st: serviceTicket, lw: "scan" },
          cookie: pollRes.cookie,
        });

        let finalCookie = infoRes.cookie;

        // 第二级激活：请求网盘配置接口，触发服务端下发核心的 __puus 字段
        const configRes = await quarkRequest(
          "GET",
          `${DRIVE_API_BASE}/1/clouddrive/config`,
          { cookie: finalCookie }
        );
        finalCookie = configRes.cookie;

        // 兜底：若仍未包含 __puus，通过 WebView 会话补全
        if (!finalCookie.includes("__puus=")) {
          await page.navigate(
            `https://pan.quark.cn/account/info?st=${serviceTicket}&lw=scan`,
            { timeoutMs: 10000 }
          );
          await page.navigate("https://pan.quark.cn/list", { timeoutMs: 10000 });
          const docCookie = await page.execute(() => document.cookie || "");
          finalCookie = mergeCookies(finalCookie, docCookie.split(";"));
        }

        gopeed.storage.set(STORAGE_COOKIE_KEY, finalCookie);
        gopeed.logger.info("[Quark] 扫码登录并导入 Cookie 成功！");
        await new Promise((r) => setTimeout(r, 800));
        return finalCookie;
      }
    }

    throw new Error("夸克扫码登录超时（3分钟），请重新创建任务");
  } finally {
    await page.close();
  }
}

/**
 * 确保获取到有效的夸克 Cookie（若缓存有效则直接复用并刷新 __puus，否则弹窗扫码）
 */
async function ensureValidCookie() {
  if (gopeed.settings?.relogin) {
    gopeed.storage.remove(STORAGE_COOKIE_KEY);
  }

  let cookie =
    gopeed.storage.get(STORAGE_COOKIE_KEY) || (gopeed.settings?.cookie || "").trim();

  if (cookie) {
    try {
      const checkRes = await quarkRequest(
        "GET",
        `${DRIVE_API_BASE}/1/clouddrive/member`,
        {
          query: { fetch_subscribe: "true" },
          cookie,
        }
      );
      if (checkRes.body?.status === 200 || checkRes.body?.code === 0) {
        return checkRes.cookie;
      }
    } catch (err) {
      gopeed.logger.warn("[Quark] Cookie 校验失败，准备唤起扫码窗口:", err);
    }
  }

  return await loginByQRCode();
}

// ==================== 夸克网盘核心业务 API ====================

/**
 * 获取或创建网盘根目录下的 GopeedTemp 临时转存文件夹
 */
async function getOrCreateTempDir(cookie) {
  const sortRes = await quarkRequest("GET", `${DRIVE_API_BASE}/1/clouddrive/file/sort`, {
    query: {
      pdir_fid: "0",
      _page: "1",
      _size: "100",
      _sort: "file_type:asc,updated_at:desc",
    },
    cookie,
  });

  const list = sortRes.body?.data?.list || [];
  const existDir = list.find((item) => item.dir && item.file_name === TEMP_FOLDER_NAME);
  if (existDir) {
    return existDir.fid;
  }

  const createRes = await quarkRequest("POST", `${DRIVE_API_BASE}/1/clouddrive/file`, {
    data: {
      pdir_fid: "0",
      file_name: TEMP_FOLDER_NAME,
      dir_path: "",
      dir_init_lock: false,
    },
    cookie,
  });

  if (createRes.body?.code !== 0) {
    throw new Error("创建临时转存目录失败: " + (createRes.body?.message || ""));
  }
  return createRes.body.data.fid;
}

/**
 * 轮询夸克异步任务状态（转存 / 删除）
 */
async function waitTaskDone(taskId, cookie) {
  for (let retry = 0; retry < 30; retry++) {
    const res = await quarkRequest("GET", `${DRIVE_API_BASE}/1/clouddrive/task`, {
      query: { task_id: taskId, retry_index: String(retry) },
      cookie,
    });
    const status = res.body?.data?.status;
    if (status === 2) {
      return res.body.data;
    }
    if (status === 3) {
      throw new Error("夸克异步任务执行失败: " + JSON.stringify(res.body));
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("等待夸克异步任务完成超时");
}

/**
 * 批量获取文件下载直链（每次最多支持 50 个 fid）
 */
async function getDownloadLinks(fids, cookie) {
  const resultMap = new Map();
  const batchSize = 40;

  for (let i = 0; i < fids.length; i += batchSize) {
    const chunk = fids.slice(i, i + batchSize);
    const res = await quarkRequest(
      "POST",
      `${DRIVE_API_BASE}/1/clouddrive/file/download`,
      {
        data: { fids: chunk },
        cookie,
      }
    );

    if (res.body?.code !== 0) {
      throw new Error("获取下载直链失败: " + (res.body?.message || ""));
    }

    const items = res.body.data || [];
    items.forEach((item) => {
      resultMap.set(item.fid, item.download_url);
    });
  }

  return resultMap;
}

/**
 * 删除已转存的临时文件以释放网盘空间
 */
async function deleteSavedFiles(fids, cookie) {
  if (!fids || fids.length === 0) return;
  try {
    const res = await quarkRequest("POST", `${DRIVE_API_BASE}/1/clouddrive/file/delete`, {
      data: { action_type: 2, filelist: fids, exclude_fids: [] },
      cookie,
    });
    if (res.body?.data?.task_id) {
      await waitTaskDone(res.body.data.task_id, cookie);
    }
  } catch (e) {
    gopeed.logger.warn("[Quark] 清理临时转存文件异常:", e);
  }
}

/**
 * 递归遍历个人网盘目录并收集所有文件
 */
async function traverseOwnFolder(pdirFid, relativePath, cookie, fileCollector = []) {
  let page = 1;
  while (true) {
    const res = await quarkRequest("GET", `${DRIVE_API_BASE}/1/clouddrive/file/sort`, {
      query: {
        pdir_fid: pdirFid,
        _page: String(page),
        _size: "100",
        _sort: "file_type:asc,file_name:asc",
      },
      cookie,
    });

    const list = res.body?.data?.list || [];
    for (const item of list) {
      if (item.dir) {
        const nextPath = relativePath ? `${relativePath}/${item.file_name}` : item.file_name;
        await traverseOwnFolder(item.fid, nextPath, cookie, fileCollector);
      } else {
        fileCollector.push({
          fid: item.fid,
          name: item.file_name,
          size: item.size,
          path: relativePath,
        });
      }
    }

    if (list.length < 100) break;
    page++;
  }
  return fileCollector;
}

/**
 * 解析分享链接（提取 pwd_id、提取码及指定子目录 fid）
 */
function parseQuarkUrl(rawUrl) {
  // 支持在 URL 末尾附带 " 密码：xxxx" 或 "?pwd=xxxx"
  let passcode = "";
  const pwdTextMatch = rawUrl.match(/(?:密码|提取码)[：:\s]*([a-zA-Z0-9]{4})/i);
  if (pwdTextMatch) {
    passcode = pwdTextMatch[1];
  }

  const cleanUrl = rawUrl.split(/\s+/)[0];
  const urlObj = new URL(cleanUrl);
  if (!passcode) {
    passcode = urlObj.searchParams.get("pwd") || "";
  }

  // 判断是否为个人网盘目录链接: https://pan.quark.cn/list#/list/all/{fid}-{name}
  if (urlObj.pathname.startsWith("/list")) {
    const hashParts = urlObj.hash.split("/").filter(Boolean);
    const lastSeg = hashParts[hashParts.length - 1] || "all";
    const pdirFid = lastSeg === "all" ? "0" : lastSeg.split("-")[0];
    return { type: "own", pdirFid };
  }

  // 分享链接: https://pan.quark.cn/s/{pwdId}
  const shareMatch = urlObj.pathname.match(/\/s\/([a-zA-Z0-9]+)/);
  if (!shareMatch) {
    throw new Error("无法识别的夸克网盘链接格式");
  }

  const pwdId = shareMatch[1];
  let pdirFid = "0";
  if (urlObj.hash.includes("/list/share/")) {
    const segs = urlObj.hash.split("/list/share/")[1]?.split("/") || [];
    const last = segs[segs.length - 1];
    if (last) {
      pdirFid = last.split("-")[0];
    }
  }

  return { type: "share", pwdId, passcode, pdirFid };
}

/**
 * 处理分享链接：校验 stoken -> 转存到 GopeedTemp -> 递归收集文件 -> 获取直链 -> 可选清理临时文件
 */
async function resolveShareLink({ pwdId, passcode, pdirFid }, cookie) {
  // 1. 获取分享 stoken
  const tokenRes = await quarkRequest(
    "POST",
    `${DRIVE_API_BASE}/1/clouddrive/share/sharepage/token`,
    {
      data: { pwd_id: pwdId, passcode },
      cookie,
    }
  );

  if (tokenRes.body?.code !== 0) {
    throw new Error("获取分享 Token 失败（请检查提取码）: " + (tokenRes.body?.message || ""));
  }
  const stoken = tokenRes.body.data.stoken;
  const shareTitle = tokenRes.body.data.title || `quark_share_${pwdId}`;

  // 2. 获取当前分享层级下的文件列表以执行转存
  const detailRes = await quarkRequest(
    "GET",
    `${DRIVE_API_BASE}/1/clouddrive/share/sharepage/detail`,
    {
      query: {
        pwd_id: pwdId,
        stoken,
        pdir_fid: pdirFid,
        _page: "1",
        _size: "100",
        _sort: "file_type:asc,file_name:asc",
      },
      cookie,
    }
  );

  const shareList = detailRes.body?.data?.list || [];
  if (shareList.length === 0) {
    throw new Error("分享链接中未找到可下载的文件");
  }

  const fidList = shareList.map((item) => item.fid);
  const fidTokenList = shareList.map((item) => item.share_fid_token);

  // 3. 将分享内容转存到网盘 GopeedTemp 文件夹下
  const tempDirFid = await getOrCreateTempDir(cookie);
  const saveRes = await quarkRequest(
    "POST",
    `${DRIVE_API_BASE}/1/clouddrive/share/sharepage/save`,
    {
      data: {
        fid_list: fidList,
        fid_token_list: fidTokenList,
        to_pdir_fid: tempDirFid,
        pwd_id: pwdId,
        stoken,
        pdir_fid: pdirFid,
        scene: "link",
      },
      cookie,
    }
  );

  if (saveRes.body?.code !== 0) {
    throw new Error("转存分享文件失败（请检查网盘剩余空间）: " + (saveRes.body?.message || ""));
  }

  const taskData = await waitTaskDone(saveRes.body.data.task_id, cookie);
  const savedTopFids = taskData?.save_as?.save_as_top_fids || [];

  // 4. 在 GopeedTemp 中定位刚才转存进来的顶层文件/文件夹并递归收集所有子文件
  const sortRes = await quarkRequest("GET", `${DRIVE_API_BASE}/1/clouddrive/file/sort`, {
    query: { pdir_fid: tempDirFid, _page: "1", _size: "200" },
    cookie,
  });
  const tempItems = (sortRes.body?.data?.list || []).filter((item) =>
    savedTopFids.includes(item.fid)
  );

  const allFiles = [];
  for (const item of tempItems) {
    if (item.dir) {
      await traverseOwnFolder(item.fid, item.file_name, cookie, allFiles);
    } else {
      allFiles.push({
        fid: item.fid,
        name: item.file_name,
        size: item.size,
        path: "",
      });
    }
  }

  // 5. 批量换取直链
  const allFids = allFiles.map((f) => f.fid);
  const linkMap = await getDownloadLinks(allFids, cookie);
  const latestCookie = gopeed.storage.get(STORAGE_COOKIE_KEY) || cookie;

  const gopeedFiles = allFiles.map((f) => ({
    name: f.name,
    path: f.path,
    size: f.size,
    req: {
      url: linkMap.get(f.fid),
      extra: {
        header: {
          "User-Agent": QUARK_UA,
          Referer: "https://pan.quark.cn/",
          Cookie: latestCookie,
        },
      },
      labels: {
        quark_fid: f.fid,
      },
    },
  }));

  // 6. 如果开启了“解析后释放空间”，自动清理本次转存的顶层节点
  if (gopeed.settings?.cleanTemp !== false) {
    await deleteSavedFiles(savedTopFids, latestCookie);
  }

  return { name: shareTitle, files: gopeedFiles };
}

// ==================== Gopeed 扩展事件注册 ====================

/**
 * 1. 解析任务事件：自动校验/扫码获取 Cookie 并解析出下载列表
 */
gopeed.events.onResolve(async (ctx) => {
  const cookie = await ensureValidCookie();
  const parsed = parseQuarkUrl(ctx.req.url);

  if (parsed.type === "own") {
    const allFiles = await traverseOwnFolder(parsed.pdirFid, "", cookie);
    if (allFiles.length === 0) {
      throw new Error("该网盘目录下没有可下载的文件");
    }

    const linkMap = await getDownloadLinks(
      allFiles.map((f) => f.fid),
      cookie
    );
    const latestCookie = gopeed.storage.get(STORAGE_COOKIE_KEY) || cookie;

    ctx.res = {
      name: `quark_dir_${parsed.pdirFid}`,
      files: allFiles.map((f) => ({
        name: f.name,
        path: f.path,
        size: f.size,
        req: {
          url: linkMap.get(f.fid),
          extra: {
            header: {
              "User-Agent": QUARK_UA,
              Referer: "https://pan.quark.cn/",
              Cookie: latestCookie,
            },
          },
          labels: {
            quark_fid: f.fid,
          },
        },
      })),
    };
    return;
  }

  ctx.res = await resolveShareLink(parsed, cookie);
});

/**
 * 2. 任务启动/续传事件：当直链过期或暂停后恢复下载时，自动刷新最新 Cookie 与直链
 */
gopeed.events.onStart(async (ctx) => {
  const fid = ctx.task?.meta?.req?.labels?.quark_fid;
  if (!fid) return;

  try {
    const cookie = await ensureValidCookie();
    const linkMap = await getDownloadLinks([fid], cookie);
    const freshUrl = linkMap.get(fid);
    const latestCookie = gopeed.storage.get(STORAGE_COOKIE_KEY) || cookie;

    if (freshUrl) {
      ctx.task.meta.req.url = freshUrl;
    }
    ctx.task.meta.req.extra = ctx.task.meta.req.extra || {};
    ctx.task.meta.req.extra.header = {
      ...(ctx.task.meta.req.extra.header || {}),
      "User-Agent": QUARK_UA,
      Referer: "https://pan.quark.cn/",
      Cookie: latestCookie,
    };
  } catch (err) {
    gopeed.logger.warn("[Quark] onStart 刷新直链失败，尝试使用原直链继续:", err);
  }
});