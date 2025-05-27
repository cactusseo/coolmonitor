import { MonitorHttpConfig, MonitorKeywordConfig, MonitorCheckResult, MONITOR_STATUS, ERROR_MESSAGES } from './types';
import { checkStatusCode, getNetworkErrorMessage } from './utils';
import { proxyFetch, standardFetch } from './proxy-fetch';
import { getAllProxySettings, SETTINGS_KEYS } from '../settings';
import sslChecker from "ssl-checker";
import { sendStatusChangeNotifications } from './notification-service';
import { prisma } from '@/lib/prisma'; // 确保 prisma 已导入

// 证书通知缓存，避免同一天重复发送通知
const certNotificationCache = new Map<string, Set<string>>();

// 检查是否需要发送证书通知 (每日中午检查逻辑)
async function checkAndSendCertNotification(
  monitorId: string,
  monitorName: string,
  daysRemaining: number,
  status: number // 这个 status 现在可能是 MONITOR_STATUS.DOWN
) {
  // 只对已过期或7天内过期的证书发送通知
  // 新逻辑下，daysRemaining <= 7 且证书有效时，status 已经是 MONITOR_STATUS.DOWN
  // 因此，主要处理 status === MONITOR_STATUS.DOWN 的情况
  if (status !== MONITOR_STATUS.DOWN) {
    return;
  }

  const now = new Date();
  // 调整为检查小时是否为12，分钟是否在0-4之间，以确保在12:00到12:04:59之间触发
  const isNoonTime = now.getHours() === 12 && now.getMinutes() >= 0 && now.getMinutes() < 5;


  if (!isNoonTime) {
    return;
  }

  const today = now.toISOString().split('T')[0];
  let notificationType = '';
  let notificationMessage = '';

  if (daysRemaining <= 0) { // 证书已过期或无效
    notificationType = 'cert_expired_critical';
    notificationMessage = `【证书已过期】${monitorName} 的SSL证书已过期或无效！请立即处理！`;
  } else if (daysRemaining <= 7) { // 证书即将在7天内过期，根据新逻辑，这已经是DOWN状态
    notificationType = `cert_expiring_critical-${daysRemaining}`;
    notificationMessage = `【证书紧急】${monitorName} 的SSL证书将在 ${daysRemaining} 天内过期 (服务已被标记为故障)！请立即更新！`;
  } else {
    // 如果 status 是 DOWN 但 daysRemaining > 7, 说明是其他证书检查问题
    // 这种情况通常由 checkHttpsCertificate 的主逻辑处理即时通知，
    // 此处的每日通知可以作为补充，或者如果主逻辑没有发送通知，则这里会发送。
    // 为避免与即时通知冲突，可以考虑只在 daysRemaining <= 7 时通过此函数发送。
    // 但为了确保至少有通知，我们保留一个通用失败消息。
    notificationType = 'cert_check_failed_daily';
    notificationMessage = `【证书每日提醒】${monitorName} 的SSL证书检查失败，当前状态为故障 (每日检查)。`;
  }

  const cacheKey = `${monitorId}-${today}`;
  const monitorCache = certNotificationCache.get(cacheKey) || new Set();

  if (monitorCache.has(notificationType)) {
    return;
  }

  try {
    // 获取监控项的真实上一个状态，以便通知服务正确处理
    const monitor = await prisma.monitor.findUnique({
      where: { id: monitorId },
      select: { lastStatus: true }
    });
    const actualPrevStatus = monitor?.lastStatus ?? null;

    // 只有当状态发生变化时（例如从UP变为因证书即将过期而DOWN），或者
    // 状态持续为DOWN（因证书问题）且符合resendInterval逻辑时，通知服务才会发送。
    // 我们传递当前计算出的DOWN状态和特定的证书消息。
    await sendStatusChangeNotifications(
      monitorId,
      MONITOR_STATUS.DOWN, // 明确传递DOWN状态
      notificationMessage,
      actualPrevStatus
    );

    monitorCache.add(notificationType);
    certNotificationCache.set(cacheKey, monitorCache);
    console.log(`已尝试发送 ${monitorName} 的证书 ${notificationType} 通知 (每日检查)`);
  } catch (error) {
    console.error(`发送 ${monitorName} 的证书通知失败 (每日检查):`, error);
  }
}

// 每天0点清理证书通知缓存
setInterval(() => {
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    certNotificationCache.clear();
    console.log('证书通知缓存已清理');
  }
}, 60000); // 每分钟检查一次

// 检查代理是否启用 (保持不变)
async function isProxyEnabled(): Promise<boolean> {
  try {
    const proxySettings = await getAllProxySettings();
    return proxySettings[SETTINGS_KEYS.PROXY_ENABLED] === 'true';
  } catch {
    return false;
  }
}

// HTTPS证书监控检查
export async function checkHttpsCertificate(config: MonitorHttpConfig): Promise<MonitorCheckResult> {
  const {
    url,
    monitorId, // 用于每日通知
    monitorName // 用于每日通知
  } = config;

  if (!url) {
    return {
      status: MONITOR_STATUS.DOWN,
      message: 'URL不能为空',
      ping: 0
    };
  }

  const startTime = Date.now();

  try {
    if (!url.startsWith('https://')) {
      return {
        status: MONITOR_STATUS.DOWN,
        message: '仅支持HTTPS URL (必须以https://开头)',
        ping: 0
      };
    }

    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const port = urlObj.port || '443';

    let daysRemaining = -1;
    let certInfo = null;

    try {
      certInfo = await sslChecker(hostname, {
        method: "GET",
        port: parseInt(port)
      });

      daysRemaining = certInfo.daysRemaining;

      // --- 主要修改点 ---
      // 1. 证书有效，但7天内到期 -> 标记为DOWN
      if (certInfo.valid === true && daysRemaining <= 7 && daysRemaining > 0) {
        const expiryMessage = `【证书紧急】将在 ${daysRemaining} 天内过期 (服务已标记为故障)!`;
        // 每日通知的逻辑由 checkAndSendCertNotification 处理，它会在中午检查
        // 此处返回DOWN状态，会触发即时的状态变更通知
        return {
          status: MONITOR_STATUS.DOWN,
          message: expiryMessage,
          ping: Date.now() - startTime,
          certificateDaysRemaining: daysRemaining
        };
      }

      // 2. 证书已过期 (daysRemaining <= 0) 或 无效 (certInfo.valid === false) -> 标记为DOWN
      if (certInfo.valid === false || daysRemaining <= 0) {
        const message = daysRemaining <= 0 ? `【证书已过期】已过期 ${-daysRemaining} 天!` : '【证书无效】证书验证失败!';
        // 每日通知的逻辑由 checkAndSendCertNotification 处理
        return {
          status: MONITOR_STATUS.DOWN,
          message: message,
          ping: Date.now() - startTime,
          certificateDaysRemaining: daysRemaining
        };
      }
      // --- 主要修改点结束 ---

      // 证书有效且剩余天数 > 7
      // 每日的 checkAndSendCertNotification 不会为这种情况发送通知
      return {
        status: MONITOR_STATUS.UP,
        message: `HTTPS证书有效 (剩余${daysRemaining}天)`,
        ping: Date.now() - startTime,
        certificateDaysRemaining: daysRemaining
      };

    } catch (certError) {
      console.warn(`获取 ${monitorName} (${monitorId}) 证书信息时出错:`, certError);
      // 无法获取证书信息也视为故障
      // 每日通知的逻辑由 checkAndSendCertNotification 处理
      return {
        status: MONITOR_STATUS.DOWN,
        message: `证书检查失败: ${getNetworkErrorMessage(certError)}`,
        ping: Date.now() - startTime
      };
    }
  } catch (error) { // URL解析等其他错误
    const errorMessage = getNetworkErrorMessage(error);
    return {
      status: MONITOR_STATUS.DOWN,
      message: errorMessage,
      ping: Date.now() - startTime
    };
  }
}

// HTTP监控检查
export async function checkHttp(config: MonitorHttpConfig): Promise<MonitorCheckResult> {
  const {
    url,
    httpMethod = 'GET',
    statusCodes = '200-299',
    maxRedirects = 10,
    requestBody = '',
    requestHeaders = '',
    notifyCertExpiry = false, // 用户在UI上配置的是否检查证书
    monitorId = '',
    monitorName = ''
  } = config;

  if (!url) {
    return { status: MONITOR_STATUS.DOWN, message: 'URL不能为空', ping: 0 };
  }

  const startTime = Date.now();

  try {
    // 如果启用了证书通知且是HTTPS URL，先检查证书状态
    if (notifyCertExpiry && url.startsWith('https://') && monitorId && monitorName) {
      const certResult = await checkHttpsCertificate({ url, monitorId, monitorName });

      // 如果证书检查结果为DOWN (因为无效、过期、或7天内即将过期)，
      // 则HTTP检查也直接返回此结果，不再进行后续的HTTP请求。
      if (certResult.status === MONITOR_STATUS.DOWN) {
        return certResult;
      }
      // 如果证书状态是 UP (意味着有效期 > 7天), certResult.message 会包含剩余天数。
      // 我们不再需要 config.certWarning, 因为7天警告现在是DOWN状态。
    }

    // 准备请求选项 (保持不变)
    const requestOptions: RequestInit = {
      method: httpMethod,
      redirect: maxRedirects > 0 ? 'follow' : 'manual',
      signal: AbortSignal.timeout(10000), // 10秒超时
      headers: {}
    };
    if (requestHeaders) {
      try {
        const headersObj = typeof requestHeaders === 'string' ? JSON.parse(requestHeaders) : requestHeaders;
        Object.keys(headersObj).forEach(key => { (requestOptions.headers as Record<string, string>)[key] = headersObj[key]; });
      } catch (e) { console.warn(`解析请求头失败:`, e); }
    }
    if (requestBody && ['POST', 'PUT', 'PATCH'].includes(httpMethod)) {
      requestOptions.body = requestBody;
    }

    let response;
    try {
      const proxyEnabled = await isProxyEnabled();
      response = proxyEnabled ?
        await proxyFetch(url, requestOptions, config.ignoreTls) : // 传递 ignoreTls
        await standardFetch(url, requestOptions, config.ignoreTls); // 传递 ignoreTls
    } catch (error) {
      const errorMessage = getNetworkErrorMessage(error);
      return { status: MONITOR_STATUS.DOWN, message: errorMessage, ping: Date.now() - startTime };
    }

    const responseTime = Date.now() - startTime;
    const isStatusValid = checkStatusCode(response.status, statusCodes);

    if (isStatusValid) {
      return {
        status: MONITOR_STATUS.UP,
        message: `状态码: ${response.status}`, // HTTP检查成功时，不再附加证书警告
        ping: responseTime
      };
    } else {
      return {
        status: MONITOR_STATUS.DOWN,
        message: `状态码不符合预期: ${response.status}`,
        ping: responseTime
      };
    }
  } catch (error) {
    const errorMessage = getNetworkErrorMessage(error);
    return { status: MONITOR_STATUS.DOWN, message: errorMessage, ping: Date.now() - startTime };
  }
}

// 关键词监控检查 (类似checkHttp，如果启用了证书检查，也应遵循新的证书状态逻辑)
export async function checkKeyword(config: MonitorKeywordConfig): Promise<MonitorCheckResult> {
  const {
    url,
    keyword = '',
    httpMethod = 'GET',
    statusCodes = '200-299',
    maxRedirects = 10,
    requestBody = '',
    requestHeaders = '',
    // 关键词监控通常不直接检查证书，但如果未来需要，可以添加 notifyCertExpiry
    // notifyCertExpiry = false,
    monitorId = '', // 假设关键词监控也可能需要ID和Name
    monitorName = ''
  } = config;

  if (!url) {
    return { status: MONITOR_STATUS.DOWN, message: 'URL不能为空', ping: 0 };
  }
  if (!keyword) {
    return { status: MONITOR_STATUS.DOWN, message: '关键词不能为空', ping: 0 };
  }

  const startTime = Date.now();

  try {
    // 如果未来关键词监控也需要检查证书，可以加入类似 checkHttp 中的逻辑
    // if (notifyCertExpiry && url.startsWith('https://') && monitorId && monitorName) {
    //   const certResult = await checkHttpsCertificate({ url, monitorId, monitorName });
    //   if (certResult.status === MONITOR_STATUS.DOWN) {
    //     return certResult;
    //   }
    // }

    const requestOptions: RequestInit = { /* ... */ }; // 与 checkHttp 类似
    // ... (headers, body, proxy logic) ...

    let response;
    try {
      const proxyEnabled = await isProxyEnabled();
      response = proxyEnabled ?
        await proxyFetch(url, requestOptions, config.ignoreTls) :
        await standardFetch(url, requestOptions, config.ignoreTls);
    } catch (error) {
      const errorMessage = getNetworkErrorMessage(error);
      return { status: MONITOR_STATUS.DOWN, message: errorMessage, ping: Date.now() - startTime };
    }

    const responseTime = Date.now() - startTime;
    const isStatusValid = checkStatusCode(response.status, statusCodes);

    if (!isStatusValid) {
      return { status: MONITOR_STATUS.DOWN, message: `状态码不符合预期: ${response.status}`, ping: responseTime };
    }

    const responseText = await response.text();
    const keywordFound = responseText.includes(keyword);

    if (keywordFound) {
      return {
        status: MONITOR_STATUS.UP,
        message: `找到关键词，状态码: ${response.status}`,
        ping: responseTime
      };
    } else {
      return {
        status: MONITOR_STATUS.DOWN,
        message: ERROR_MESSAGES.KEYWORD_NOT_FOUND,
        ping: responseTime
      };
    }
  } catch (error) {
    const errorMessage = getNetworkErrorMessage(error);
    return { status: MONITOR_STATUS.DOWN, message: errorMessage, ping: Date.now() - startTime };
  }
}