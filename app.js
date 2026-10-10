(() => {
  'use strict';

  // Follow the visible area as browser bars move, without resizing for pinch zoom.
  let viewportFrame = null;
  function updateViewportHeight() {
    viewportFrame = null;
    const viewport = window.visualViewport;
    const height = viewport && Math.abs(viewport.scale - 1) < 0.01
      ? viewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vvh', `${Math.round(height)}px`);
  }
  function scheduleViewportHeight() {
    if (viewportFrame === null) viewportFrame = requestAnimationFrame(updateViewportHeight);
  }
  updateViewportHeight();
  window.addEventListener('resize', scheduleViewportHeight);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleViewportHeight);
  window.addEventListener('orientationchange', () => {
    scheduleViewportHeight();
    setTimeout(scheduleViewportHeight, 300);
  });

  const countdown = document.querySelector('#countdown');
  const progress = document.querySelector('#progress');
  const status = document.querySelector('#status');
  const finishLabel = document.querySelector('#finish-label');
  const pauseButton = document.querySelector('#pause');
  const stopButton = document.querySelector('#stop');
  const presets = [...document.querySelectorAll('.preset')];
  const circumference = 2 * Math.PI * 146;
  let state = 'idle';
  let duration = 0;
  let remaining = 0;
  let endTime = 0;
  let frame = null;
  let interval = null;
  let audioContext = null;
  let wakeLock = null;
  let wakeLockPending = false;
  let renderedState = null;
  let renderedDuration = null;
  let notificationRegistration = null;
  let firstPresetTap = true;
  let notificationSecond = null;
  let finishedNotificationShown = false;
  const warned = new Set();

  progress.style.strokeDasharray = String(circumference);

  async function updateNotification() {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted' || !notificationRegistration) return;
      const registration = notificationRegistration;
      const icon = './icons/icon-192.png';
      if (state === 'idle') {
        const notifications = await registration.getNotifications({ tag: 'timer' });
        notifications.forEach((notification) => notification.close());
        return;
      }
      if (state === 'finished') {
        if (finishedNotificationShown) return;
        finishedNotificationShown = true;
        try {
          await registration.showNotification('Recupero finito!', {
            tag: 'timer', renotify: true, silent: false, requireInteraction: false,
            vibrate: [300, 150, 300, 150, 600],
            body: 'Tocca un tempo per il prossimo recupero', icon, badge: icon,
          });
        } catch { finishedNotificationShown = false; }
        return;
      }
      const seconds = Math.ceil(remaining / 1000);
      const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      const finish = new Date(endTime).toLocaleTimeString('it-IT', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      const body = state === 'running'
        ? `Restano ${time} · finisce alle ${finish}` : `In pausa · ${time}`;
      const actions = [
        state === 'running' ? { action: 'pause', title: 'Pausa' } : { action: 'resume', title: 'Riprendi' },
        { action: 'stop', title: 'Stop' },
      ];
      await registration.showNotification('Timer Palestra', {
        tag: 'timer', renotify: false, silent: true, requireInteraction: true,
        icon, badge: icon, body, data: { state }, actions,
      });
    } catch { /* Notifications are optional. */ }
  }

  function unlockAudio() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      if (!audioContext) audioContext = new AudioContext();
      // A silent buffer started inside the gesture unlocks audio on iOS.
      const source = audioContext.createBufferSource();
      source.buffer = audioContext.createBuffer(1, 1, audioContext.sampleRate);
      source.connect(audioContext.destination);
      source.start();
      if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    } catch { /* Audio is optional. The visual alert always remains available. */ }
  }

  function beep(finishing = false) {
    if (!audioContext || audioContext.state !== 'running') return;
    try {
      const now = audioContext.currentTime;
      const count = finishing ? 3 : 1;
      const length = finishing ? 0.35 : 0.09;
      for (let i = 0; i < count; i += 1) {
        const start = now + i * 0.5;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = finishing ? 880 : 660;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.3, start + 0.01);
        gain.gain.setValueAtTime(0.3, start + length - 0.025);
        gain.gain.linearRampToValueAtTime(0, start + length);
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
        oscillator.start(start);
        oscillator.stop(start + length + 0.01);
      }
    } catch { /* Some browsers cannot play audio while in the background. */ }
  }

  async function acquireWakeLock() {
    if (!navigator.wakeLock || state !== 'running' || document.visibilityState !== 'visible' || wakeLock || wakeLockPending) return;
    wakeLockPending = true;
    let discarded = false;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (state !== 'running' || document.visibilityState !== 'visible') {
        discarded = true;
        await lock.release();
        return;
      }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } catch { /* Unsupported, denied, or low battery: the timer still works. */ }
    finally {
      wakeLockPending = false;
      // Visibility may change again while a stale request is being released.
      if (discarded && state === 'running' && document.visibilityState === 'visible') void acquireWakeLock();
    }
  }

  function releaseWakeLock() {
    if (!wakeLock) return;
    const lock = wakeLock;
    wakeLock = null;
    try { Promise.resolve(lock.release()).catch(() => {}); } catch { /* Already released. */ }
  }

  function render() {
    const seconds = Math.ceil(remaining / 1000);
    const display = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    if (countdown.textContent !== display) countdown.textContent = display;
    progress.style.strokeDashoffset = String(circumference * (1 - (duration ? remaining / duration : 0)));
    // Announce state changes once, without rewriting the live region each frame.
    if (renderedState === state && renderedDuration === duration) return;
    renderedState = state;
    renderedDuration = duration;
    document.body.dataset.state = state;
    document.body.classList.toggle('finished', state === 'finished');
    finishLabel.hidden = state !== 'finished';
    status.textContent = { idle: 'Scegli il recupero', running: 'In corso', paused: 'In pausa', finished: 'Recupero finito!' }[state];
    pauseButton.textContent = state === 'paused' ? 'Riprendi' : 'Pausa';
    pauseButton.disabled = state !== 'running' && state !== 'paused';
    stopButton.disabled = state === 'idle';
    for (const button of presets) {
      button.setAttribute('aria-pressed', String(state !== 'idle' && Number(button.dataset.seconds) * 1000 === duration));
    }
  }

  function stopUpdates() {
    if (frame !== null) cancelAnimationFrame(frame);
    if (interval !== null) clearInterval(interval);
    frame = null;
    interval = null;
  }

  function update(notify = true) {
    if (state !== 'running') return;
    remaining = Math.max(0, Math.min(duration, endTime - Date.now()));
    if (remaining === 0) {
      state = 'finished';
      stopUpdates();
      releaseWakeLock();
      beep(true);
      try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 600]); } catch { /* Optional. */ }
      void updateNotification();
    } else {
      const seconds = Math.ceil(remaining / 1000);
      if (seconds !== notificationSecond) {
        notificationSecond = seconds;
        if (notify) void updateNotification();
      }
      if (seconds <= 3 && !warned.has(seconds)) {
        warned.add(seconds);
        beep();
      }
    }
    render();
  }

  function animationUpdate() {
    frame = null;
    update();
    if (state === 'running') frame = requestAnimationFrame(animationUpdate);
  }

  function startUpdates() {
    stopUpdates();
    update();
    if (state !== 'running') return;
    frame = requestAnimationFrame(animationUpdate);
    interval = setInterval(update, 200);
    void acquireWakeLock();
  }

  for (const button of presets) {
    button.addEventListener('click', () => {
      if (firstPresetTap) {
        firstPresetTap = false;
        try {
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission().then(() => updateNotification()).catch(() => {});
          }
        } catch { /* Permission may be unavailable. */ }
      }
      unlockAudio();
      duration = Number(button.dataset.seconds) * 1000;
      remaining = duration;
      endTime = Date.now() + remaining;
      warned.clear();
      state = 'running';
      finishedNotificationShown = false;
      notificationSecond = Math.ceil(remaining / 1000);
      startUpdates();
      void updateNotification();
    });
  }

  function pause(notify = true) {
    if (state === 'running') {
      update();
      if (state !== 'running') return;
      state = 'paused';
      stopUpdates();
      releaseWakeLock();
      render();
      if (notify) void updateNotification();
    }
  }

  function resume(notify = true) {
    if (state === 'paused') {
      endTime = Date.now() + remaining;
      state = 'running';
      notificationSecond = Math.ceil(remaining / 1000);
      startUpdates();
      if (notify) void updateNotification();
    }
  }

  pauseButton.addEventListener('click', () => {
    unlockAudio();
    if (state === 'running') pause();
    else if (state === 'paused') resume();
  });

  function stop(notify = true) {
    state = 'idle';
    remaining = 0;
    duration = 0;
    warned.clear();
    stopUpdates();
    releaseWakeLock();
    render();
    if (notify) void updateNotification();
  }

  stopButton.addEventListener('click', () => {
    unlockAudio();
    stop();
  });

  document.addEventListener('visibilitychange', () => {
    if (state === 'running') {
      update(false);
      if (document.visibilityState === 'visible') void acquireWakeLock();
      else releaseWakeLock();
    }
    void updateNotification();
  });

  render();
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.ready.then((registration) => {
        notificationRegistration = registration;
        void updateNotification();
      }).catch(() => {});
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type !== 'timer-action') return;
        if (event.data.action === 'pause') pause(false);
        else if (event.data.action === 'resume') resume(false);
        else if (event.data.action === 'stop') stop(false);
        else return;
        void updateNotification();
      });
      // Deliver messages from the worker even before this page is controlled.
      if (navigator.serviceWorker.startMessages) navigator.serviceWorker.startMessages();
    } catch { /* Notifications are optional. */ }
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then((reg) => reg.update())
      .catch(() => { /* Requires HTTPS or localhost; updates may be offline. */ });
  }
})();
