<script setup lang="ts">
import { computed, reactive, ref, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import { startAuthentication } from '@simplewebauthn/browser';
import { useAuthStore } from '../stores/auth.store';
import { resolveLoginErrorKey } from '../utils/apiError';
import VueHcaptcha from '@hcaptcha/vue3-hcaptcha';
import VueRecaptcha from 'vue3-recaptcha2'; // 使用默认导入

const { t } = useI18n();
const authStore = useAuthStore();
// 获取 loginRequires2FA 状态
const {
  isLoading,
  error,
  loginRequires2FA,
  publicCaptchaConfig,
  hasPasskeysAvailable,
  bootstrapStatus,
  bootstrapError,
} = storeToRefs(authStore);

// 表单数据
const credentials = reactive({
  username: '',
  password: '',
});
const twoFactorToken = ref(''); // 用于存储 2FA 验证码
const rememberMe = ref(false); // 记住我状态，默认为 false
const captchaToken = ref<string | null>(null); //  Store CAPTCHA token
const captchaError = ref<string | null>(null); //  Store CAPTCHA specific error
const hcaptchaWidget = ref<InstanceType<typeof VueHcaptcha> | null>(null); //  Ref for hCaptcha component instance
const recaptchaWidget = ref<InstanceType<typeof VueRecaptcha> | null>(null); // 更新 Ref 类型以匹配新导入
const displayError = computed(() => error.value?.startsWith('login.') ? t(error.value) : error.value);

// --- reCAPTCHA v3 Initialization ---
// const recaptchaInstance = useReCaptcha(); // 移除 v3 实例，因为我们将使用 v2 组件


// --- CAPTCHA Event Handlers ---
const handleCaptchaVerified = (token: string) => {
  // console.log('CAPTCHA verified, token:', token);
  captchaToken.value = token;
  captchaError.value = null; // Clear error on successful verification
};
const handleCaptchaExpired = () => {
  // console.log('CAPTCHA expired');
  captchaToken.value = null;
};
const handleCaptchaError = (errorDetails: any) => {
  console.error('CAPTCHA error:', errorDetails);
  captchaToken.value = null;
  captchaError.value = t('login.error.captchaLoadFailed');
};
const resetCaptchaWidget = () => {
  // console.log('Resetting CAPTCHA widget...');
  captchaToken.value = null;
  // Reset hCaptcha if it exists
  hcaptchaWidget.value?.reset();
  // Reset reCAPTCHA v2 if it exists
  recaptchaWidget.value?.reset();
};


// 处理登录或 2FA 验证提交
const handleSubmit = async () => {
  captchaError.value = null; // Clear previous CAPTCHA error

  // --- CAPTCHA Execution & Check ---
  // --- CAPTCHA Check (v2/hCaptcha) ---
  if (publicCaptchaConfig.value?.enabled && !loginRequires2FA.value) {
    // Check if token exists (obtained via component event for v2/hCaptcha)
    if (!captchaToken.value) {
      captchaError.value = t('login.error.captchaRequired');
      return; // Stop submission if CAPTCHA is required but not completed
    }
  }

  try {
    if (loginRequires2FA.value) {
      // 如果需要 2FA，则调用 2FA 验证 action
      await authStore.verifyLogin2FA(twoFactorToken.value);
    } else {
      // 否则，调用常规登录 action，并传递 rememberMe 和 captchaToken 状态
      await authStore.login({
          ...credentials,
          rememberMe: rememberMe.value,
          captchaToken: captchaToken.value ?? undefined // Pass token or undefined if null
      });
    }
    // 成功后的重定向由 store action 处理
    // 失败会更新 error 状态并在模板中显示
  } finally {
     // Reset CAPTCHA after attempt (success or failure handled by store redirect/error display)
     if (publicCaptchaConfig.value?.enabled) {
       resetCaptchaWidget(); // Reset the widget for potential retry
     }
  } // <-- Correctly closing the try block here
};

 // Fetch CAPTCHA config and check passkey availability on component mount
onMounted(async () => {
  // console.log('[LoginView] Component mounted, calling fetchCaptchaConfig and checkHasPasskeysConfigured...');
  authStore.fetchCaptchaConfig();
  // Check if passkeys are available for login (uses the new public endpoint)
  // Optionally pass username if needed: await authStore.checkHasPasskeysConfigured(credentials.username);
  await authStore.checkHasPasskeysConfigured();
});

// --- Passkey Login Handler ---
const handlePasskeyLogin = async () => {
  try {
    isLoading.value = true;
    error.value = null; // Clear previous errors

    // Prepare body for authentication options request
    // If username is provided, include it. Otherwise, send an empty object
    // to allow the backend to attempt discoverable credential authentication.
    const authOptionsBody = credentials.username ? { username: credentials.username } : {};

    // Step 1: Get authentication options from the server
    const optionsResponse = await fetch('/api/v1/auth/passkey/authentication-options', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(authOptionsBody),
    });

    if (!optionsResponse.ok) {
      const errorData = await optionsResponse.json().catch(() => undefined);
      error.value = t(resolveLoginErrorKey({ response: { data: errorData } }));
      return;
    }
    const authOptions = await optionsResponse.json();

    // Step 2: Use WebAuthn API to authenticate
    const authenticationResult = await startAuthentication(authOptions);

    // Step 3: Send authentication result to the server
    // Pass username if it was used to get options, otherwise pass null or rely on backend to extract from assertion
    // For simplicity, we'll pass the username if available, or an empty string if not.
    // The store action `loginWithPasskey` expects a string.
    // The backend should ideally identify the user from the assertion if an empty username is provided.
    const loginResult = await authStore.loginWithPasskey(credentials.username || '', authenticationResult);
    if (!loginResult.success) {
      error.value = t(loginResult.error || 'login.error.passkeyAuthFailed');
    }

  } catch (err: unknown) {
    console.error('Passkey login error:', err);
    error.value = t('login.error.passkeyAuthFailed');
    // Potentially reset CAPTCHA if it was involved, though typically not for passkey flows directly
    // if (publicCaptchaConfig.value?.enabled) {
    //   resetCaptchaWidget();
    // }
  } finally {
    isLoading.value = false;
  }
};

const handleRetryBootstrap = async () => {
  const recovered = await authStore.retryAuthBootstrap();
  if (recovered && authStore.isAuthenticated) {
    window.location.href = '/';
  }
};

</script>
<template>
  <div class="auth-page">
    <section class="auth-shell">
      <div class="auth-brand">
        <img src="../assets/logo.png" :alt="t('projectName')" class="auth-logo">
        <div>
          <p class="auth-eyebrow">{{ t('login.title') }}</p>
          <h1>{{ t('projectName') }}</h1>
          <p class="auth-copy">{{ t('slogan') }}</p>
        </div>
      </div>

      <div class="auth-panel">
        <div class="auth-panel-header">
          <img src="../assets/logo.png" :alt="t('projectName')" class="auth-mobile-logo">
          <p class="auth-eyebrow">{{ t('projectName') }}</p>
          <h2>{{ t('login.title') }}</h2>
        </div>

        <div v-if="bootstrapStatus === 'unavailable'" class="auth-form" role="alert">
          <p class="auth-error">{{ t(bootstrapError || 'login.error.serviceUnavailable') }}</p>
          <button type="button" :disabled="isLoading" class="auth-submit" @click="handleRetryBootstrap">
            {{ isLoading ? t('login.retrying') : t('login.retry') }}
          </button>
        </div>

        <form v-else @submit.prevent="handleSubmit" class="auth-form">
          <div v-if="!loginRequires2FA" class="auth-fields">
            <label class="auth-field" for="username">
              <span>{{ t('login.username') }}</span>
              <input type="text" id="username" v-model="credentials.username" required :disabled="isLoading" autocomplete="username" />
            </label>
            <label class="auth-field" for="password">
              <span>{{ t('login.password') }}</span>
              <input type="password" id="password" v-model="credentials.password" required :disabled="isLoading" autocomplete="current-password" />
            </label>
            <label class="auth-check" for="rememberMe">
              <input type="checkbox" id="rememberMe" v-model="rememberMe" :disabled="isLoading" />
              <span>{{ t('login.rememberMe', '记住我') }}</span>
            </label>
          </div>

          <label v-if="loginRequires2FA" class="auth-field" for="twoFactorToken">
            <span>{{ t('login.twoFactorPrompt') }}</span>
            <input type="text" id="twoFactorToken" v-model="twoFactorToken" required :disabled="isLoading" pattern="\d{6}" title="请输入 6 位数字验证码" inputmode="numeric" />
          </label>

          <div v-if="publicCaptchaConfig && publicCaptchaConfig.enabled && !loginRequires2FA" class="auth-captcha">
            <span>{{ t('login.captchaPrompt') }}</span>
            <div v-if="publicCaptchaConfig?.provider === 'hcaptcha' && publicCaptchaConfig.hcaptchaSiteKey">
              <VueHcaptcha
                ref="hcaptchaWidget"
                :sitekey="publicCaptchaConfig.hcaptchaSiteKey"
                @verify="handleCaptchaVerified"
                @expired="handleCaptchaExpired"
                @error="handleCaptchaError"
                theme="auto"
              ></VueHcaptcha>
            </div>
            <div v-else-if="publicCaptchaConfig?.provider === 'recaptcha' && publicCaptchaConfig.recaptchaSiteKey">
              <VueRecaptcha
                ref="recaptchaWidget"
                :sitekey="publicCaptchaConfig.recaptchaSiteKey"
                @verify="handleCaptchaVerified"
                @expire="handleCaptchaExpired"
                @fail="handleCaptchaError"
                theme="light"
              />
            </div>
            <div v-if="captchaError" class="auth-error">
              {{ captchaError }}
            </div>
          </div>

          <div v-if="error" class="auth-error">
            {{ displayError }}
          </div>

          <button type="submit" :disabled="isLoading" class="auth-submit">
            {{ isLoading ? t('login.loggingIn') : (loginRequires2FA ? t('login.verifyButton') : t('login.loginButton')) }}
          </button>

          <button v-if="hasPasskeysAvailable" type="button" @click="handlePasskeyLogin" :disabled="isLoading" class="auth-secondary">
            <i class="fas fa-key"></i>
            <span>{{ isLoading ? t('login.loggingIn') : t('login.loginWithPasskey') }}</span>
          </button>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(1rem, 3vw, 2.5rem);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--primary, #2563eb) 12%, transparent), transparent 36%),
    radial-gradient(circle at 18% 18%, color-mix(in srgb, var(--link-active-color) 18%, transparent), transparent 30%),
    radial-gradient(circle at 82% 76%, color-mix(in srgb, var(--link-hover-color) 14%, transparent), transparent 28%),
    var(--app-bg-color);
}

.auth-shell {
  width: min(960px, 100%);
  min-height: 560px;
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(340px, 1fr);
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 72%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--app-bg-color) 88%, transparent);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.16);
}

.auth-brand {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 2rem;
  padding: clamp(2rem, 5vw, 4rem);
  color: #fff;
  background:
    linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.86)),
    linear-gradient(135deg, var(--link-active-color), var(--link-hover-color));
}

.auth-brand::after {
  content: "";
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.08) 1px, transparent 1px);
  background-size: 26px 26px;
  mask-image: linear-gradient(135deg, #000, transparent 78%);
  pointer-events: none;
}

.auth-brand > * {
  position: relative;
  z-index: 1;
}

.auth-logo {
  width: 72px;
  height: 72px;
  object-fit: contain;
}

.auth-eyebrow {
  margin: 0 0 0.75rem;
  color: color-mix(in srgb, currentColor 70%, transparent);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.auth-brand h1 {
  margin: 0;
  font-size: clamp(2rem, 4vw, 3.25rem);
  line-height: 1.02;
  letter-spacing: 0;
}

.auth-copy {
  max-width: 20rem;
  margin: 1rem 0 0;
  color: rgba(255, 255, 255, 0.76);
  font-size: 0.95rem;
}

.auth-panel {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: clamp(2rem, 5vw, 4rem);
  background: color-mix(in srgb, var(--app-bg-color) 96%, white);
}

.auth-panel-header {
  margin-bottom: 1.75rem;
}

.auth-mobile-logo {
  display: none;
  width: 56px;
  height: 56px;
  object-fit: contain;
  margin-bottom: 1rem;
}

.auth-panel h2 {
  margin: 0;
  color: var(--text-color);
  font-size: clamp(1.55rem, 3vw, 2rem);
  line-height: 1.15;
}

.auth-form,
.auth-fields {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.auth-field {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  color: var(--text-color);
  font-size: 0.88rem;
  font-weight: 600;
}

.auth-field input {
  width: 100%;
  height: 46px;
  padding: 0 0.9rem;
  border: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
  border-radius: 6px;
  background: var(--app-bg-color);
  color: var(--text-color);
  font-size: 0.95rem;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease;
}

.auth-field input:focus {
  border-color: var(--link-active-color) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--link-active-color) 18%, transparent) !important;
}

.auth-field input:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.auth-check {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-color-secondary);
  font-size: 0.88rem;
}

.auth-check input {
  width: 16px;
  height: 16px;
  accent-color: var(--link-active-color);
}

.auth-captcha {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: var(--text-color-secondary);
  font-size: 0.88rem;
}

.auth-error {
  border: 1px solid color-mix(in srgb, var(--color-error) 26%, transparent);
  border-radius: 6px;
  padding: 0.7rem 0.85rem;
  background: color-mix(in srgb, var(--color-error) 10%, transparent);
  color: var(--color-error);
  font-size: 0.88rem;
}

.auth-submit,
.auth-secondary {
  width: 100%;
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 0;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 700;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease, opacity 0.16s ease;
}

.auth-submit {
  margin-top: 0.25rem;
  background: #111827;
  color: #fff;
  box-shadow: 0 12px 22px rgba(17, 24, 39, 0.18);
}

.auth-submit:hover:not(:disabled),
.auth-secondary:hover:not(:disabled) {
  transform: translateY(-1px);
}

.auth-submit:disabled,
.auth-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.auth-secondary {
  background: color-mix(in srgb, var(--app-bg-color) 84%, var(--border-color));
  color: var(--text-color);
  border: 1px solid color-mix(in srgb, var(--border-color) 76%, transparent);
}

@media (max-width: 780px) {
  .auth-page {
    align-items: stretch;
    padding: 1rem;
  }

  .auth-shell {
    min-height: auto;
    grid-template-columns: 1fr;
  }

  .auth-brand {
    display: none;
  }

  .auth-mobile-logo {
    display: block;
  }

  .auth-panel {
    min-height: calc(100dvh - 2rem);
    padding: 2rem 1.25rem;
  }
}
</style>
