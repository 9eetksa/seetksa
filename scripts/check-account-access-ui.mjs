import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const paths = { client: '/client/dashboard', employee: '/employee/dashboard', admin: '/admin/workspace' };
const names = { client: 'مساحة العميل', employee: 'مساحة الفريق', admin: 'إدارة المنصة' };
const authTab = 'account-access-browser-qa';

export async function runBrowserChecks({ ownerSession, fixtures, baseUrl = 'http://localhost:5173' }) {
  assert.ok(ownerSession?.access_token && ownerSession?.user?.id, 'QA owner session is required');
  assert.ok(Array.isArray(fixtures), 'QA account fixtures must be an array');
  for (const role of Object.keys(paths)) assert.ok(fixtures.some(fixture => fixture.role === role && fixture.id && fixture.email), `Missing QA ${role} fixture`);
  const allowedOrigin = new URL(baseUrl).origin;
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname), 'Browser QA helper is restricted to local preview');
  const browser = await chromium.launch({ headless: true, ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ar-SA', timezoneId: 'Asia/Riyadh', reducedMotion: 'reduce' });
  await context.addInitScript(({ session, origin, tab }) => {
    if (window.location.origin !== origin || sessionStorage.getItem('account-access-qa-seeded')) return;
    localStorage.removeItem('provision-remember');
    localStorage.removeItem('provision-auth-device');
    sessionStorage.setItem('provision-auth-tab', tab);
    sessionStorage.setItem(`provision-auth-${tab}`, JSON.stringify(session));
    sessionStorage.setItem('account-access-qa-seeded', 'true');
  }, { session: ownerSession, origin: allowedOrigin, tab: authTab });
  const page = await context.newPage();
  page.setDefaultTimeout(25000);
  const pageErrors = [];
  const failedAccessRequests = [];
  const networkFailures = [];
  const pendingRequests = new Map();
  const retiredScopes = new Map();
  const requestSequence = new WeakMap();
  const failedScopes = new WeakMap();
  let sequence = 0;
  let bootstrapRetries = 0;
  const checks = [];
  let phase = 'bootstrap';
  const scrub = value => {
    let text = String(value || '');
    for (const secret of [ownerSession.access_token, ownerSession.refresh_token].filter(Boolean)) text = text.replaceAll(secret, '[redacted-token]');
    return text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
      .replace(/https?:\/\/[^\s)"']+/g, value => { try { return new URL(value).pathname; } catch { return '[redacted-url]'; } })
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[redacted-id]')
      .slice(0, 3000);
  };
  page.on('pageerror', error => pageErrors.push({ phase, name: error.name || 'PageError', message: scrub(error.message) }));
  page.on('request', request => {
    requestSequence.set(request, ++sequence);
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/impersonation' || pathname === '/auth/v1/user' || pathname.includes('/rpc/platform_access_check')) pendingRequests.set(request, { phase, path: pathname });
    if (pathname !== '/api/impersonation') return;
    let body;
    try { body = request.postDataJSON(); } catch {}
    if (body?.action === 'end' && typeof body.sessionId === 'string') retiredScopes.set(body.sessionId, sequence);
  });
  page.on('response', response => {
    pendingRequests.delete(response.request());
    const url = new URL(response.url());
    if (response.status() >= 400 && (url.pathname === '/api/impersonation' || /\/rpc\/(platform_access_check|platform_account_directory|platform_account_brief)$/.test(url.pathname))) {
      let body;
      try { body = response.request().postDataJSON(); } catch {}
      const entry = { phase, path: url.pathname, status: response.status(), action: typeof body?.action === 'string' ? scrub(body.action) : null, resource: typeof body?.path === 'string' ? scrub(body.path.split('?')[0]) : null };
      failedAccessRequests.push(entry);
      failedScopes.set(entry, { sessionId: body?.sessionId, started: requestSequence.get(response.request()) });
    }
  });
  page.on('requestfailed', request => {
    const record = pendingRequests.get(request);
    pendingRequests.delete(request);
    if (record) networkFailures.push({ ...record, error: scrub(request.failure()?.errorText) });
  });

  async function ownerDirectory() {
    await page.waitForURL(url => url.pathname === '/admin/dashboard');
    if (!await page.locator('.ad-directory').isVisible()) {
      await page.getByRole('button', { name: 'الحسابات والصلاحيات', exact: true }).click();
    }
    await page.locator('.ad-directory').waitFor({ state: 'visible' });
  }

  async function accountManagement(fixture) {
    phase = `${fixture.role} directory and summary`;
    await ownerDirectory();
    const directory = page.locator('.ad-directory');
    await directory.getByRole('searchbox', { name: 'البحث عن حساب' }).fill(fixture.email);
    await directory.getByRole('button', { name: 'بحث', exact: true }).click();
    const row = directory.locator('.ad-row').filter({ hasText: fixture.email });
    await row.waitFor({ state: 'visible' });
    await row.click();
    const brief = page.locator('dialog.ad-brief[open]');
    await brief.waitFor({ state: 'visible' });
    await brief.getByRole('button', { name: 'إدارة الحساب', exact: true }).click();
    await brief.getByRole('button', { name: 'الدخول بهذا الحساب', exact: true }).waitFor({ state: 'visible' });
    return brief;
  }

  async function enter(fixture) {
    const brief = await accountManagement(fixture);
    const button = brief.getByRole('button', { name: 'الدخول بهذا الحساب', exact: true });
    assert.ok(await button.isEnabled(), `QA ${fixture.role} entry must be enabled`);
    phase = `${fixture.role} enter and route`;
    await button.click();
    await page.waitForURL(url => url.pathname === paths[fixture.role]);
    const banner = page.locator('.a-account-session');
    await banner.waitFor({ state: 'visible' });
    assert.ok((await banner.textContent()).includes(fixture.email), `Banner must identify the real ${fixture.role} fixture`);
    const sidebar = page.locator(fixture.role === 'client' ? '.c-sidebar' : '.a-sidebar');
    await sidebar.waitFor({ state: 'visible' });
    assert.ok((await sidebar.textContent()).includes(names[fixture.role]), `Actual ${fixture.role} navigation must render`);
    assert.ok(await page.evaluate(({ tab, ownerId }) => {
      const stored = JSON.parse(sessionStorage.getItem(`provision-auth-${tab}`) || 'null');
      return stored?.user?.id === ownerId;
    }, { tab: authTab, ownerId: ownerSession.user.id }), 'Original owner Auth session must remain unchanged');
    assert.equal(await page.locator('.a-workspace-cards').count(), 0, 'Legacy placeholder workspace must not render');
    checks.push({ check: `${fixture.role} real account route and identity`, passed: true });
  }

  async function exit() {
    phase = 'exit to owner directory';
    await page.getByRole('button', { name: 'إنهاء الدخول والعودة للسوبر أدمن', exact: true }).click();
    await ownerDirectory();
    assert.equal(await page.locator('.a-account-session').count(), 0, 'Delegation banner must disappear on exit');
    checks.push({ check: 'exit restores superadmin account directory', passed: true });
  }

  async function capture(filename) {
    await mkdir(resolve('.tools'), { recursive: true });
    await page.screenshot({
      path: resolve('.tools', filename), fullPage: false,
      mask: [page.locator('.a-account-session-identity bdi'), page.locator('.c-sidebar-account'), page.locator('.a-owner'), page.locator('.ad-list'), page.locator('input[type=email]')],
    });
  }

  try {
    await page.goto(`${allowedOrigin}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
    const accountNavigation = page.getByRole('button', { name: 'الحسابات والصلاحيات', exact: true });
    const retryAccess = page.locator('.a-loading').getByRole('button', { name: /^إعادة (المحاولة|التحقق)$/ });
    const initialState = await Promise.race([accountNavigation.waitFor({ state: 'visible' }).then(() => 'ready'), retryAccess.waitFor({ state: 'visible' }).then(() => 'retry')]);
    if (initialState === 'retry') {
      bootstrapRetries++;
      await retryAccess.click();
    }
    await ownerDirectory();
    for (const role of ['client', 'employee', 'admin']) {
      await enter(fixtures.find(fixture => fixture.role === role));
      if (role === 'client') await capture('account-access-qa-desktop.png');
      await exit();
    }

    const client = fixtures.find(fixture => fixture.role === 'client');
    const brief = await accountManagement(client);
    phase = 'lifecycle controls';
    await brief.getByRole('button', { name: 'إدارة حالة الحساب', exact: true }).click();
    const dialog = page.locator('dialog.a-access-dialog[open]');
    await dialog.waitFor({ state: 'visible' });
    await dialog.locator('#account-access-operation').selectOption('suspend-until');
    assert.ok(await dialog.locator('#account-access-until').isVisible(), 'Temporary suspension must expose its expiry field');
    assert.equal(await dialog.locator('#account-access-reason').getAttribute('required'), '', 'Lifecycle reason is required');
    await dialog.locator('#account-access-operation').selectOption('delete');
    const deleteButton = dialog.getByRole('button', { name: 'حذف الحساب', exact: true });
    assert.ok(await deleteButton.isDisabled(), 'Deletion must require typed confirmation');
    await dialog.locator('#account-access-confirmation').fill(client.email);
    await dialog.locator('#account-access-reason').fill('مراجعة واجهة اختبارية دون تنفيذ');
    assert.ok(await deleteButton.isEnabled(), 'Matching confirmation enables deliberate deletion control');
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)), 'Native lifecycle dialog retains keyboard focus');
    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await brief.getByRole('button', { name: 'إغلاق ملخص الحساب', exact: true }).click();
    checks.push({ check: 'lifecycle date reason confirmation and focus without mutation', passed: true });

    await enter(client);
    phase = 'mobile viewport';
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(dimensions.document <= dimensions.viewport + 2 && dimensions.body <= dimensions.viewport + 2, 'Account view must not overflow horizontally at 375px');
    const bannerBox = await page.locator('.a-account-session').boundingBox();
    assert.ok(bannerBox && bannerBox.x >= -1 && bannerBox.x + bannerBox.width <= 377, 'Mobile identity banner must stay inside the viewport');
    await page.getByRole('button', { name: 'إنهاء الدخول والعودة للسوبر أدمن', exact: true }).waitFor({ state: 'visible' });
    await capture('account-access-qa-mobile.png');
    checks.push({ check: '375px overflow identity banner and readable exit', passed: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await exit();
    phase = 'final runtime and network assertions';
    assert.equal(pageErrors.length, 0, `Browser runtime errors ${JSON.stringify(pageErrors)}`);
    const expectedClosedScopeRequests = failedAccessRequests.filter(entry => {
      const scope = failedScopes.get(entry);
      const ended = retiredScopes.get(scope?.sessionId);
      return entry.path === '/api/impersonation' && ['proxy','status'].includes(entry.action) && [401,403].includes(entry.status) && ended != null && scope.started < ended;
    });
    const unexpectedFailures = failedAccessRequests.filter(entry => !expectedClosedScopeRequests.includes(entry));
    // Ending an account revokes its server session immediately  Previously
    // issued reads may therefore finish as403 while their old view unmounts
    assert.equal(unexpectedFailures.length, 0, `Account access requests failed ${JSON.stringify(unexpectedFailures)}`);
    const result = { success: true, checks, pageErrors, failedAccessRequests: unexpectedFailures, expectedClosedScopeRequests, networkFailures, bootstrapRetries, screenshots: ['.tools/account-access-qa-desktop.png', '.tools/account-access-qa-mobile.png'], visualBaseline: 'not provided', lifecycleMutations: 0 };
    await writeFile(resolve('.tools', 'account-access-ui-result.json'), JSON.stringify(result, null, 2));
    return result;
  } catch (failure) {
    const diagnostic = { success: false, phase, message: scrub(failure.message), checks, pageErrors, failedAccessRequests, networkFailures, pendingRequests: [...pendingRequests.values()], bootstrapRetries, route: new URL(page.url()).pathname, lifecycleMutations: 0 };
    await mkdir(resolve('.tools'), { recursive: true });
    await page.screenshot({ path: resolve('.tools', 'account-access-qa-failure.png'), fullPage: false, mask: [page.locator('.a-account-session-identity bdi'), page.locator('.a-admin-main'), page.locator('.ad-brief'), page.locator('.c-sidebar-account'), page.locator('.a-owner'), page.locator('input')] }).catch(() => {});
    await writeFile(resolve('.tools', 'account-access-ui-result.json'), JSON.stringify(diagnostic, null, 2));
    const error = new Error(`Account access UI check failed during ${phase}`);
    error.diagnostic = diagnostic;
    throw error;
  } finally {
    // Close only this generated QA owner's delegated session before fixtures
    // are removed  No customer account action is issued by this helper
    const acting = await page.evaluate(() => sessionStorage.getItem('provision-acting-session')).catch(() => null);
    if (acting) await context.request.post(`${allowedOrigin}/api/impersonation`, {
      headers: { Authorization: `Bearer ${ownerSession.access_token}` },
      data: { action: 'end', sessionId: acting },
    }).catch(() => {});
    await context.close();
    await browser.close();
  }
}
