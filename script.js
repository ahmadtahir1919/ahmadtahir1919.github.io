// Quizoma landing page — minimal interactivity matching the Figma
// "Container/Button" layers that imply interaction (mobile nav toggle,
// FAQ accordion, filter chip switching).

document.addEventListener('DOMContentLoaded', function () {
  // Shrink the sticky header once the page scrolls, so it stays compact
  // instead of permanently taking up a tall fixed band.
  var siteHeader = document.getElementById('site-header');
  if (siteHeader) {
    var updateHeaderScrolled = function () {
      siteHeader.classList.toggle('is-scrolled', window.scrollY > 8);
    };
    updateHeaderScrolled();
    window.addEventListener('scroll', updateHeaderScrolled, { passive: true });
  }

  // Hero headline: type out "dual smart grading." on load instead of just
  // appearing, so the page feels a little more alive on first visit. Falls
  // back to the plain static text (already in the HTML) with no JS or when
  // the visitor prefers reduced motion.
  var typewriterEl = document.getElementById('typewriter-word');
  var reduceMotionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (typewriterEl && !(reduceMotionQuery && reduceMotionQuery.matches)) {
    var fullText = typewriterEl.textContent;
    typewriterEl.textContent = '';
    typewriterEl.classList.add('typing');
    var charIndex = 0;
    setTimeout(function typeNextChar() {
      charIndex++;
      typewriterEl.textContent = fullText.slice(0, charIndex);
      if (charIndex < fullText.length) {
        setTimeout(typeNextChar, 105);
      } else {
        setTimeout(function () { typewriterEl.classList.remove('typing'); }, 700);
      }
    }, 400);
  }

  // Hero "X Online" count: a believable random headcount that drifts a
  // little over time instead of a hardcoded number.
  var onlineCount = document.getElementById('online-count');
  if (onlineCount) {
    var currentOnline = 20 + Math.floor(Math.random() * 81); // 20–100
    onlineCount.textContent = currentOnline + ' Online';
    setInterval(function () {
      var delta = Math.floor(Math.random() * 7) - 3; // small drift, -3..+3
      currentOnline = Math.min(100, Math.max(20, currentOnline + delta));
      onlineCount.textContent = currentOnline + ' Online';
    }, 4000);
  }

  // Mobile hamburger nav toggle
  var hamburger = document.getElementById('hamburger');
  var mobileNav = document.getElementById('mobile-nav');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', function () {
      var isOpen = mobileNav.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobileNav.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // FAQ accordion
  document.querySelectorAll('.faq-item').forEach(function (item) {
    var btn = item.querySelector('.faq-question');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(function (open) {
        if (open !== item) open.classList.remove('open');
      });
      item.classList.toggle('open', !isOpen);
    });
  });

  // Stage filter chips (Interactive Stage Chips / Filter Tabs)
  var chips = document.querySelectorAll('.filter-chips .chip-pill');
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      chips.forEach(function (c) { c.classList.remove('chip-pill-active'); });
      chip.classList.add('chip-pill-active');
    });
  });

  // Room-code PIN inputs: type a character and focus jumps to the next box;
  // backspace on an empty box jumps back to the previous one.
  var pinBoxes = Array.prototype.slice.call(document.querySelectorAll('.pin-box'));
  pinBoxes.forEach(function (box, index) {
    box.addEventListener('input', function () {
      box.value = box.value.slice(-1).toUpperCase();
      if (box.value && index < pinBoxes.length - 1) {
        pinBoxes[index + 1].focus();
      }
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'Backspace' && !box.value && index > 0) {
        pinBoxes[index - 1].focus();
      }
    });
    box.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text').trim().toUpperCase();
      for (var i = 0; i < text.length && index + i < pinBoxes.length; i++) {
        pinBoxes[index + i].value = text[i];
      }
      var next = pinBoxes[Math.min(index + text.length, pinBoxes.length - 1)];
      next.focus();
    });
  });

  // Hero mini-quiz card: click an option to see the dual-track grading in
  // action (typo-tolerant correct answer vs. gentle, non-punitive wrong-answer
  // feedback that resets itself).
  var quizGroup = document.getElementById('mini-quiz-options');
  var quizFeedback = document.getElementById('mini-quiz-feedback');
  if (quizGroup) {
    var quizOptions = Array.prototype.slice.call(quizGroup.querySelectorAll('.option'));
    var CHECK_ICON = '<svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
    var CROSS_ICON = '<svg viewBox="0 0 20 20" fill="currentColor" width="10" height="10"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>';

    quizOptions.forEach(function (btn) {
      var letter = btn.querySelector('.option-letter');
      if (letter) letter.dataset.letter = letter.textContent.trim();
    });

    function resetQuizOption(btn) {
      var letter = btn.querySelector('.option-letter');
      btn.classList.remove('option-correct', 'option-incorrect', 'option-pop', 'option-shake');
      btn.setAttribute('aria-pressed', 'false');
      if (letter) {
        letter.classList.remove('option-letter-correct', 'option-letter-incorrect');
        letter.textContent = letter.dataset.letter;
      }
    }

    // Shared by real clicks and the auto-demo below. `isAuto` just skips the
    // haptic (vibrate needs a real user gesture anyway).
    function activateQuizOption(btn, isAuto) {
      var isCorrect = btn.dataset.correct === 'true';
      var letter = btn.querySelector('.option-letter');

      // Clear + reflow so the animation can retrigger on repeated activations.
      btn.classList.remove('option-pop', 'option-shake');
      void btn.offsetWidth;

      if (isCorrect) {
        quizOptions.forEach(function (o) { if (o !== btn) resetQuizOption(o); });
        btn.classList.add('option-correct', 'option-pop');
        btn.setAttribute('aria-pressed', 'true');
        if (letter) {
          letter.classList.remove('option-letter-incorrect');
          letter.classList.add('option-letter-correct');
          letter.innerHTML = CHECK_ICON;
        }
        if (quizFeedback) quizFeedback.classList.remove('feedback-banner-hidden');
        if (!isAuto && navigator.vibrate) navigator.vibrate([30, 40, 30]);
      } else {
        btn.classList.add('option-incorrect', 'option-shake');
        btn.setAttribute('aria-pressed', 'true');
        if (letter) {
          letter.classList.add('option-letter-incorrect');
          letter.innerHTML = CROSS_ICON;
        }
        if (!isAuto && navigator.vibrate) navigator.vibrate(60);
        setTimeout(function () { resetQuizOption(btn); }, 1200);
      }
    }

    // Auto-demo: steps through the options in order every couple seconds so
    // the hero card feels alive even before anyone touches it. A real click
    // pauses it for a while so it never fights the visitor's own input.
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var autoplayTimer = null;
    var autoplayPausedUntil = 0;
    var autoplayIndex = Math.floor(Math.random() * quizOptions.length);

    function scheduleQuizAutoplay() {
      if (reduceMotion) return;
      if (autoplayTimer) clearTimeout(autoplayTimer);
      var delay = 1500 + Math.random() * 700; // 1.5s–2.2s, slight wobble so it doesn't feel robotic
      autoplayTimer = setTimeout(function () {
        if (Date.now() < autoplayPausedUntil || document.hidden) {
          scheduleQuizAutoplay();
          return;
        }
        activateQuizOption(quizOptions[autoplayIndex], true);
        autoplayIndex = (autoplayIndex + 1) % quizOptions.length;
        scheduleQuizAutoplay();
      }, delay);
    }

    quizOptions.forEach(function (btn) {
      btn.addEventListener('click', function () {
        autoplayPausedUntil = Date.now() + 5000;
        activateQuizOption(btn, false);
      });
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleQuizAutoplay();
    });

    scheduleQuizAutoplay();
  }

  // Hero mini-quiz card, part 2: a slider cycling through all 6 question
  // formats (Single Choice, Multiple Correct, True/False, Written Answer,
  // Fill in the Blank, Live Poll), each with a small "now showing" pill and
  // a matching animated example — so the hero shows the full range Quizoma
  // supports, not just one MCQ.
  var quizSlider = document.getElementById('mini-quiz-slider');
  var quizTrack = document.getElementById('mini-quiz-track');
  if (quizSlider && quizTrack) {
    var formatSlides = Array.prototype.slice.call(quizTrack.querySelectorAll('.mini-quiz-slide'));
    var formatDots = Array.prototype.slice.call(document.querySelectorAll('#mini-quiz-indicators .mq-dot'));
    var formatPillIcon = document.getElementById('format-pill-icon');
    var formatPillLabel = document.getElementById('format-pill-label');

    var ICON_STROKE = 'fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
    var FORMATS = [
      { label: 'Single Choice', icon: '<svg width="14" height="14" viewBox="0 0 24 24" ' + ICON_STROKE + '><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="3.5" fill="#fff" stroke="none"></circle></svg>' },
      { label: 'Multiple Correct', icon: '<svg width="14" height="14" viewBox="0 0 24 24" ' + ICON_STROKE + '><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>' },
      { label: 'True / False', icon: '<svg width="14" height="14" viewBox="0 0 24 24" ' + ICON_STROKE + '><circle cx="7" cy="12" r="5"></circle><path d="M4.7 12l1.5 1.6L9.3 10"></path><circle cx="17" cy="12" r="5"></circle><path d="M14.8 9.8l4.4 4.4M19.2 9.8l-4.4 4.4"></path></svg>' },
      { label: 'Written Answer', icon: '<svg width="14" height="14" viewBox="0 0 24 24" ' + ICON_STROKE + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>' },
      { label: 'Fill in the Blank', icon: '<svg width="14" height="14" viewBox="0 0 24 24" ' + ICON_STROKE + '><line x1="3" y1="12" x2="7" y2="12"></line><line x1="9.5" y1="12" x2="14.5" y2="12" stroke-dasharray="2.2 2.2"></line><line x1="17" y1="12" x2="21" y2="12"></line></svg>' },
      { label: 'Live Poll', icon: '<svg width="14" height="14" viewBox="0 0 24 24" ' + ICON_STROKE + '><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>' }
    ];

    var formatReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var currentFormatSlide = 0;
    var formatAutoplayTimer = null;
    var formatAutoplayPausedUntil = 0;

    function goToFormatSlide(index) {
      currentFormatSlide = index;
      var step = 100 / formatSlides.length;
      quizTrack.style.transform = 'translateX(-' + (index * step) + '%)';
      formatSlides.forEach(function (slide, i) { slide.classList.toggle('slide-active', i === index); });
      formatDots.forEach(function (dot, i) { dot.classList.toggle('active', i === index); });
      if (formatPillIcon) formatPillIcon.innerHTML = FORMATS[index].icon;
      if (formatPillLabel) formatPillLabel.textContent = FORMATS[index].label;
    }

    function scheduleFormatAutoplay() {
      if (formatReduceMotion) return;
      if (formatAutoplayTimer) clearTimeout(formatAutoplayTimer);
      formatAutoplayTimer = setTimeout(function () {
        if (Date.now() < formatAutoplayPausedUntil || document.hidden) {
          scheduleFormatAutoplay();
          return;
        }
        goToFormatSlide((currentFormatSlide + 1) % formatSlides.length);
        scheduleFormatAutoplay();
      }, 4500);
    }

    formatDots.forEach(function (dot, i) {
      dot.addEventListener('click', function () {
        formatAutoplayPausedUntil = Date.now() + 8000;
        goToFormatSlide(i);
      });
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleFormatAutoplay();
    });

    goToFormatSlide(0);
    scheduleFormatAutoplay();
  }
});
