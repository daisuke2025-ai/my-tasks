const SUPABASE_URL = "https://gecmhfmyjzrntlffcubb.supabase.co";
const SUPABASE_KEY = "sb_publishable_L8fsjlE_j-1Sc2nJ13aiGQ_iLtzNdjM";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
window.supabaseClient = supabaseClient;
const authSection = document.getElementById("authSection");
const authForm = document.getElementById("authForm");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authMessage = document.getElementById("authMessage");
const signupButton = document.getElementById("signupButton");
const logoutButton = document.getElementById("logoutButton");
const changePasswordButton = document.getElementById("changePasswordButton");
const loginOpenButton = document.getElementById("loginOpenButton");
const guestContinueButton = document.getElementById("guestContinueButton");
const userPanel = document.getElementById("userPanel");
const userEmail = document.getElementById("userEmail");
const appMain = document.querySelector("main.app");
function showAuthMessage(message) {
  authMessage.textContent = message;
}
function updateAuthUI(session) {
  const loggedIn = Boolean(session?.user);
  appMain.hidden = false;
  userPanel.hidden = false;
  loginOpenButton.hidden = loggedIn;
  logoutButton.hidden = !loggedIn;
  changePasswordButton.hidden = !loggedIn;
  userEmail.textContent = loggedIn
    ? session.user.email || ""
    : "ゲスト利用中（このブラウザー内に保存）";
  if (loggedIn) authSection.hidden = true;
}
loginOpenButton.addEventListener("click", () => {
  authSection.hidden = false;
  authEmail.focus();
});
guestContinueButton.addEventListener("click", () => {
  authSection.hidden = true;
  showAuthMessage("");
});
let lastUserId = undefined;
let sessionGeneration = 0;
async function applySession(session) {
  const id = session?.user?.id || null;
  if (id === lastUserId) return;
  const generation = ++sessionGeneration;
  lastUserId = id;
  updateAuthUI(session);
  try {
    await window.setCloudUser(session?.user || null);
  } catch (error) {
    console.error(error);
    if (generation !== sessionGeneration) return;
    alert(
      "データの読み込み・引き継ぎに失敗しました。ゲストデータは削除していません。\n" +
        error.message,
    );
  }
}
authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showAuthMessage("ログイン中...");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: authEmail.value.trim(),
    password: authPassword.value,
  });
  if (error) {
    showAuthMessage("ログイン失敗：" + error.message);
    return;
  }
  authPassword.value = "";
  showAuthMessage("");
});
signupButton.addEventListener("click", async () => {
  if (!authForm.reportValidity()) return;
  showAuthMessage("アカウントを登録中...");
  const { data, error } = await supabaseClient.auth.signUp({
    email: authEmail.value.trim(),
    password: authPassword.value,
  });
  if (error) {
    showAuthMessage("登録失敗：" + error.message);
    return;
  }
  authPassword.value = "";
  showAuthMessage(
    data.session
      ? "登録が完了しました。"
      : "登録を受け付けました。確認メールを開いて認証後、ログインしてください。",
  );
});
logoutButton.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (error) alert("ログアウト失敗：" + error.message);
});
// Password changes and email recovery use Supabase Auth, not public tables.
const passwordOverlay = document.getElementById("passwordOverlay");
const passwordForm = document.getElementById("passwordForm");
const passwordMessage = document.getElementById("passwordMessage");
const passwordDescription = document.getElementById("passwordDescription");
const passwordDialogTitle = document.getElementById("passwordDialogTitle");
const resetRequestOverlay = document.getElementById("resetRequestOverlay");
const resetRequestForm = document.getElementById("resetRequestForm");
const resetRequestMessage = document.getElementById("resetRequestMessage");
let recoveryMode = false;
function openPasswordDialog(recovery) {
  recoveryMode = recovery;
  passwordDialogTitle.textContent = recovery
    ? "新しいパスワードを設定"
    : "パスワードを変更";
  passwordDescription.textContent = recovery
    ? "メールの再設定リンクを確認しました。新しいパスワードを入力してください。"
    : "ログイン中のアカウントのパスワードを変更します。";
  passwordMessage.textContent = "";
  passwordForm.reset();
  passwordOverlay.hidden = false;
  document.getElementById("newPassword").focus();
}
changePasswordButton.addEventListener("click", () => openPasswordDialog(false));
document.getElementById("closePasswordButton").addEventListener("click", () => {
  if (recoveryMode) {
    // The recovery session remains active; the user may reopen the form by reloading the recovery URL.
    if (!confirm("パスワードの再設定を中断しますか？")) return;
  }
  passwordOverlay.hidden = true;
});
document
  .getElementById("forgotPasswordButton")
  .addEventListener("click", () => {
    resetRequestForm.reset();
    document.getElementById("resetEmail").value = authEmail.value.trim();
    resetRequestMessage.textContent = "";
    resetRequestOverlay.hidden = false;
    document.getElementById("resetEmail").focus();
  });
document
  .getElementById("closeResetRequestButton")
  .addEventListener("click", () => {
    resetRequestOverlay.hidden = true;
  });
resetRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.getElementById("sendResetButton");
  button.disabled = true;
  resetRequestMessage.textContent = "送信中…";
  try {
    // Keep the deployed GitHub Pages path, including repository subdirectory.
    const redirectTo =
      new URL("./", window.location.href).origin +
      new URL("./", window.location.href).pathname;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(
      document.getElementById("resetEmail").value.trim(),
      { redirectTo },
    );
    if (error) throw error;
    resetRequestMessage.textContent =
      "メールを送信しました。届いた場合はリンクを開いてください。迷惑メールフォルダも確認してください。";
  } catch (error) {
    resetRequestMessage.textContent = "送信できませんでした：" + error.message;
  } finally {
    button.disabled = false;
  }
});
passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = document.getElementById("newPassword").value;
  if (password !== document.getElementById("confirmPassword").value) {
    passwordMessage.textContent = "確認用パスワードが一致しません。";
    return;
  }
  const button = document.getElementById("savePasswordButton");
  button.disabled = true;
  passwordMessage.textContent = "変更中…";
  try {
    const { error } = await supabaseClient.auth.updateUser({ password });
    if (error) throw error;
    passwordForm.reset();
    passwordMessage.textContent = "パスワードを変更しました。";
    recoveryMode = false;
    // Remove one-time recovery tokens from browser history without navigating away.
    if (window.location.hash || window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  } catch (error) {
    passwordMessage.textContent =
      "変更できませんでした：" +
      error.message +
      "（再認証が必要な場合は、再設定メールからお試しください）";
  } finally {
    button.disabled = false;
  }
});
supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (_event === "PASSWORD_RECOVERY") {
    openPasswordDialog(true);
  }
  // Supabase advises against awaiting database calls inside this callback.
  setTimeout(() => {
    applySession(session);
  }, 0);
});
supabaseClient.auth.getSession().then(({ data, error }) => {
  if (error) {
    console.warn(error);
    applySession(null);
    return;
  }
  applySession(data.session);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((error) => console.warn("オフライン起動の準備に失敗", error));
  });
}
