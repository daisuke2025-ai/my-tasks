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
supabaseClient.auth.onAuthStateChange((_event, session) => {
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
