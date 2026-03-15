const deployBtn = document.getElementById("deployBtn");
const input = document.getElementById("githubUsername");
const message = document.getElementById("message");

const SOURCE_OWNER = "RichieeTechsHub";
const REPO_NAME = "Lite-Ollver-MD";

function showMessage(text, type = "info") {
  message.textContent = text;
  message.className = `message ${type}`;
}

function hideMessage() {
  message.className = "message hidden";
  message.textContent = "";
}

async function verifyFork(username) {
  const apiUrl = `https://api.github.com/repos/${username}/${REPO_NAME}`;
  const res = await fetch(apiUrl);

  if (res.status === 404) {
    return {
      ok: false,
      reason: "Repo not found. Fork Lite-Ollver-MD first."
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: "GitHub check failed. Try again in a moment."
    };
  }

  const repo = await res.json();

  if (!repo.fork) {
    return {
      ok: false,
      reason: "Repo exists, but it is not marked as a fork."
    };
  }

  const parentFullName = repo.parent?.full_name || "";
  const sourceFullName = `${SOURCE_OWNER}/${REPO_NAME}`;

  if (parentFullName && parentFullName !== sourceFullName) {
    return {
      ok: false,
      reason: `Repo is forked from ${parentFullName}, not ${sourceFullName}.`
    };
  }

  return {
    ok: true,
    repoUrl: repo.html_url
  };
}

deployBtn.addEventListener("click", async () => {
  hideMessage();

  const username = input.value.trim();

  if (!username) {
    showMessage("Enter your GitHub username first.", "error");
    return;
  }

  showMessage("Checking your forked repository...", "info");
  deployBtn.disabled = true;

  try {
    const result = await verifyFork(username);

    if (!result.ok) {
      showMessage(result.reason, "error");
      deployBtn.disabled = false;
      return;
    }

    showMessage("Repository verified. Redirecting to Heroku...", "success");

    const template = encodeURIComponent(
      `https://github.com/${username}/${REPO_NAME}`
    );

    setTimeout(() => {
      window.location.href = `https://heroku.com/deploy?template=${template}`;
    }, 900);
  } catch (error) {
    showMessage("Something went wrong while verifying the repo.", "error");
    deployBtn.disabled = false;
  }
});