<template>
  <div class="auth-page">
    <section class="auth-shell">
      <div class="auth-brand">
        <img src="../assets/logo.png" :alt="$t('projectName')" class="auth-logo">
        <div>
          <p class="auth-eyebrow">{{ $t('setup.title') }}</p>
          <h1>{{ $t('projectName') }}</h1>
          <p class="auth-copy">{{ $t('setup.description') }}</p>
        </div>
      </div>

      <div class="auth-panel">
        <div class="auth-panel-header">
          <img src="../assets/logo.png" :alt="$t('projectName')" class="auth-mobile-logo">
          <p class="auth-eyebrow">{{ $t('projectName') }}</p>
          <h2>{{ $t('setup.title') }}</h2>
          <p>{{ $t('setup.description') }}</p>
        </div>

        <form @submit.prevent="handleSetup" class="auth-form">
          <label class="auth-field" for="username">
            <span>{{ $t('setup.username') }}</span>
            <input
              id="username"
              v-model="username"
              name="username"
              type="text"
              required
              :disabled="isLoading"
              :placeholder="$t('setup.usernamePlaceholder')"
              autocomplete="username"
            />
          </label>

          <label class="auth-field" for="password">
            <span>{{ $t('setup.password') }}</span>
            <input
              id="password"
              v-model="password"
              name="password"
              type="password"
              required
              :disabled="isLoading"
              :placeholder="$t('setup.passwordPlaceholder')"
              autocomplete="new-password"
            />
          </label>

          <label class="auth-field" for="confirmPassword">
            <span>{{ $t('setup.confirmPassword') }}</span>
            <input
              id="confirmPassword"
              v-model="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              :disabled="isLoading"
              :placeholder="$t('setup.confirmPasswordPlaceholder')"
              autocomplete="new-password"
            />
          </label>

          <div v-if="error" class="auth-error">
            {{ error }}
          </div>
          <div v-if="successMessage" class="auth-success">
            {{ successMessage }}
          </div>

          <button type="submit" :disabled="isLoading" class="auth-submit">
            <span v-if="isLoading">{{ $t('setup.settingUp') }}</span>
            <span v-else>{{ $t('setup.submitButton') }}</span>
          </button>
        </form>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import apiClient from '../utils/apiClient'; // 使用统一的 apiClient
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '../stores/auth.store'; // *** 导入 Auth Store ***

const { t } = useI18n();
const router = useRouter();
const authStore = useAuthStore(); // *** 获取 Auth Store 实例 ***

const username = ref('');
const password = ref('');
const confirmPassword = ref('');
const isLoading = ref(false);
const error = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const handleSetup = async () => {
  error.value = null;
  successMessage.value = null;

  if (password.value !== confirmPassword.value) {
    error.value = t('setup.error.passwordsDoNotMatch');
    return;
  }

  if (!username.value || !password.value) {
      error.value = t('setup.error.fieldsRequired');
      return;
  }

  isLoading.value = true;

  try {
    // 确保调用正确的后端 API 端点
    await apiClient.post('/auth/setup', { // 使用 apiClient 并移除 base URL
      username: username.value,
      password: password.value,
      confirmPassword: confirmPassword.value
    });
    successMessage.value = t('setup.success');
    // *** 手动更新 needsSetup 状态 ***
    authStore.needsSetup = false;
    // *** 重置认证状态，因为设置完成后需要重新登录 ***
    authStore.isAuthenticated = false;
    authStore.user = null;
    // 禁用表单或按钮，防止重复提交
    isLoading.value = true; // Keep loading state to disable button
    // Redirect to login immediately after showing success message (removed setTimeout)
    // The success message will be briefly visible before navigation.
    router.push('/login');
  } catch (err: any) {
    console.error('Setup failed:', err);
    if (err.response?.data?.message) {
      // 尝试从后端响应中获取更具体的错误信息
      error.value = err.response.data.message;
    } else if (err.message) {
       error.value = err.message;
    } else {
       error.value = t('setup.error.generic');
    }
     isLoading.value = false; // Re-enable button on error
  }
  // Removed finally block setting isLoading to false on success to keep button disabled
};
</script>

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

.auth-panel-header p:not(.auth-eyebrow) {
  margin: 0.65rem 0 0;
  color: var(--text-color-secondary);
  font-size: 0.92rem;
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

.auth-form {
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

.auth-error,
.auth-success {
  border-radius: 6px;
  padding: 0.7rem 0.85rem;
  font-size: 0.88rem;
}

.auth-error {
  border: 1px solid color-mix(in srgb, var(--color-error) 26%, transparent);
  background: color-mix(in srgb, var(--color-error) 10%, transparent);
  color: var(--color-error);
}

.auth-success {
  border: 1px solid color-mix(in srgb, var(--color-success) 26%, transparent);
  background: color-mix(in srgb, var(--color-success) 10%, transparent);
  color: var(--color-success);
}

.auth-submit {
  width: 100%;
  min-height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: #111827;
  color: #fff;
  box-shadow: 0 12px 22px rgba(17, 24, 39, 0.18);
  font-size: 0.95rem;
  font-weight: 700;
  transition: transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease, opacity 0.16s ease;
}

.auth-submit:hover:not(:disabled) {
  transform: translateY(-1px);
}

.auth-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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
