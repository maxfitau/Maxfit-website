/* Card showcase — the video plays itself, muted and looping, only
   while it's actually on screen, and pauses the moment it scrolls
   out (battery/data, and it stops being a random paused frame the
   rest of the time). The mute button is the one bit of real
   interaction: tap to unmute, tap again to re-mute.

   Fails safe: the <video> has native controls and autoplay is never
   promised, so with no IntersectionObserver support (practically
   none left) or if this file fails to load, it's just a normal video
   a visitor presses play on themselves. */
document.addEventListener("DOMContentLoaded", function () {
  var video = document.getElementById("showcaseVideo");
  var muteBtn = document.getElementById("showcaseMuteBtn");
  if (!video) return;

  if ("IntersectionObserver" in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var p = video.play();
            if (p && typeof p.catch === "function") p.catch(function () {});
          } else {
            video.pause();
          }
        });
      },
      { threshold: 0.4 }
    );
    observer.observe(video);
  }

  if (muteBtn) {
    muteBtn.addEventListener("click", function () {
      video.muted = !video.muted;
      muteBtn.setAttribute("aria-pressed", video.muted ? "false" : "true");
      muteBtn.setAttribute("aria-label", video.muted ? "Unmute video" : "Mute video");
    });
  }
});
