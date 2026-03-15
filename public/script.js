document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("pairForm");
  const numberInput = document.getElementById("number");
  const statusText = document.getElementById("status");
  const pairingCodeBox = document.getElementById("pairingCode");
  const submitBtn = document.getElementById("submitBtn");

  let jobId = null;
  let polling = null;

  function setStatus(text) {
    statusText.innerText = `Status: ${text}`;
  }

  function setCode(text) {
    pairingCodeBox.innerText = text || "----";
  }

  function stopPolling() {
    if (polling) {
      clearTimeout(polling);
      polling = null;
    }
  }

  async function pollStatus() {
    if (!jobId) return;

    try {
      const res = await fetch(`/api/status/${jobId}`, {
        method: "GET"
      });

      const data = await res.json();

      if (!data.ok) {
        setStatus(data.message || "Unable to check pairing status");
        return;
      }

      if (data.status) {
        setStatus(data.status);
      }

      if (data.pairingCode) {
        setCode(data.pairingCode);
      }

      if (data.status === "delivered") {
        setStatus("session sent to WhatsApp inbox");
        submitBtn.disabled = false;
        stopPolling();
        return;
      }

      if (data.status === "error") {
        setStatus(data.error || "pairing failed");
        submitBtn.disabled = false;
        stopPolling();
        return;
      }

      polling = setTimeout(pollStatus, 2000);
    } catch (error) {
      setStatus("network error while checking status");
      submitBtn.disabled = false;
      stopPolling();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    stopPolling();

    const number = numberInput.value.trim();

    if (!number) {
      setStatus("enter WhatsApp number");
      return;
    }

    setStatus("starting pairing...");
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
        setStatus(data.message || "failed to start pairing");
        submitBtn.disabled = false;
        return;
      }

      jobId = data.jobId;
      setStatus("waiting for pairing code...");
      pollStatus();
    } catch (error) {
      setStatus("request failed");
      submitBtn.disabled = false;
    }
  });
});