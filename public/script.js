const form = document.querySelector("form");
const numberInput = document.querySelector("input");
const statusText = document.querySelector("#status");
const codeBox = document.querySelector("#pairingCode");

let jobId = null;

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const number = numberInput.value.trim();

  if (!number) {
    alert("Enter WhatsApp number");
    return;
  }

  statusText.innerText = "Starting pairing...";
  codeBox.innerText = "----";

  const res = await fetch("/api/pair", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ number }),
  });

  const data = await res.json();

  if (!data.ok) {
    statusText.innerText = data.message;
    return;
  }

  jobId = data.jobId;

  checkStatus();
});

async function checkStatus() {
  if (!jobId) return;

  const res = await fetch(`/api/status/${jobId}`);
  const data = await res.json();

  if (!data.ok) {
    statusText.innerText = data.message;
    return;
  }

  statusText.innerText = `Status: ${data.status}`;

  if (data.pairingCode) {
    codeBox.innerText = data.pairingCode;
  }

  if (data.status !== "delivered" && data.status !== "error") {
    setTimeout(checkStatus, 2000);
  }
}