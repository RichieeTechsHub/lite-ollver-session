const form = document.getElementById("pairForm");
const numberInput = document.getElementById("number");
const statusText = document.getElementById("statusText");
const pairingCode = document.getElementById("pairingCode");
const submitBtn = document.getElementById("submitBtn");

let pollTimer = null;

function setStatus(text) {
  statusText.textContent = text;
}

function setCode(text) {
  pairingCode.textContent = text || "----";
}

async function pollStatus(jobId) {
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/status/${jobId}`);
      const data = await res.json();

      if (!data.ok) {
        clearInterval(pollTimer);
        setStatus("Error");
        return;
      }

      if (data.status === "pairing_code_ready" && data.pairingCode) {
        setStatus("Pairing code ready");
        setCode(data.pairingCode);
      }

      if (data.status === "connected") {
        setStatus("Connected, preparing session...");
      }

      if (data.status === "delivered") {
        setStatus("Session sent to WhatsApp inbox");
        clearInterval(pollTimer);
      }

      if (data.status === "error") {
        setStatus(data.error || "Error");
        clearInterval(pollTimer);
      }
    } catch (error) {
      setStatus("Connection error");
      clearInterval(pollTimer);
    }
  }, 2000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const number = numberInput.value.trim();
  if (!number) return;

  clearInterval(pollTimer);
  setStatus("Starting...");
  setCode("----");
  submitBtn.disabled = true;

  try {
    const res = await fetch("/api/pair", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ number })
    });

    const data = await res.json();

    if (!data.ok) {
      setStatus(data.message || "Failed to start");
      submitBtn.disabled = false;
      return;
    }

    setStatus("Waiting for pairing code...");
    pollStatus(data.jobId);
  } catch (error) {
    setStatus("Request failed");
  } finally {
    submitBtn.disabled = false;
  }
});