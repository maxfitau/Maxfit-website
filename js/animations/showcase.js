/* Card showcase: the video plays itself, muted and looping, only while
   it's actually on screen, and pauses the moment it scrolls out
   (battery/data, and it stops being a random paused frame the rest of
   the time).

   There is intentionally no unmute control. The original soundtrack is
   copyrighted music, so the video is silent by design (and the audio
   track has been stripped from the file itself too).

   Fails safe: with no IntersectionObserver support or if this file
   fails to load, the video simply shows its poster frame. */
document.addEventListener("DOMContentLoaded", function () {
  var video = document.getElementById("showcaseVideo");
  if (!video) return;

  video.muted = true;
  video.volume = 0;

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
});
