document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("pairForm");
  const numberInput = document.getElementById("number");
  const statusText = document.getElementById("status");
  const pairingCodeBox = document.getElementById("pairingCode");
  const submitBtn = document.getElementById("submitBtn");

  let jobId = localStorage.getItem("lite_ollver_job_id") || null;
  let activeNumber = localStorage.getItem("lite_ollver_number") || "";
  let polling = null;
  let isSubmitting = false;

  if (activeNumber) {
    numberInput.value = activeNumber;
  }

  function setStatus(text) {
    statusText.innerText = `Status: ${text}`;
  }

  function setCode(text) {
    pairingCodeBox.innerText = text || "----";
  }

  function saveJob(currentJobId, number) {
    localStorage.setItem("lite_ollver_job_id", currentJobId);
    localStorage.setItem("lite_ollver_number", number);
  }

  function clearJob() {
    localStorage.removeItem("lite_ollver_job_id");
    localStorage.removeItem("lite_ollver_number");
    jobId = null;
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
      const res = await fetch(`/api/status/${jobId}`);
      const data = await res.json();

      if (!data.ok) {
        setStatus(data.message || "job not found");
        submitBtn.disabled = false;
        isSubmitting = false;
        clearJob();
        stopPolling();
        return;
      }

      if (data.status) {
        setStatus(data.status);
      }

      if (data.pairingCode) {
        setCode(data.pairingCode);
      }

      if (data.status === "delivered") {
        setStatus("session delivered");
        submitBtn.disabled = false;
        isSubmitting = false;
        clearJob();
        stopPolling();
        return;
      }

      if (data.status === "error" || data.status === "closed") {
        setStatus(data.error || data.status);
        submitBtn.disabled = false;
        isSubmitting = false;
        clearJob();
        stopPolling();
        return;
      }

      polling = setTimeout(pollStatus, 2000);
    } catch (error) {
      setStatus("network error");
      submitBtn.disabled = false;
      isSubmitting = false;
      stopPolling();
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isSubmitting) return;

    const number = numberInput.value.trim();

    if (!number) {
      setStatus("enter WhatsApp number");
      return;
    }

    // If same active job exists in this browser, just resume polling
    if (jobId && activeNumber === number) {
      setStatus("resuming active pairing job...");
      submitBtn.disabled = true;
      isSubmitting = true;
      stopPolling();
      pollStatus();
      return;
    }

    stopPolling();
    isSubmitting = true;
    submitBtn.disabled = true;
    setStatus("starting pairing...");
    setCode("----");

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
        isSubmitting = false;
        return;
      }

      jobId = data.jobId;
      activeNumber = number;
      saveJob(jobId, number);

      if (data.reused) {
        setStatus("existing pairing process reused");
      } else {
        setStatus("waiting for pairing code...");
      }

      pollStatus();
    } catch (error) {
      setStatus("request failed");
      submitBtn.disabled = false;
      isSubmitting = false;
    }
  });

  // Resume active job automatically on page load
  if (jobId) {
    submitBtn.disabled = true;
    isSubmitting = true;
    setStatus("resuming previous pairing job...");
    pollStatus();
  }
});