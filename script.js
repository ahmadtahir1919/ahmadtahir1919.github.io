// Quizoma landing page — minimal interactivity matching the Figma
// "Container/Button" layers that imply interaction (mobile nav toggle,
// FAQ accordion, filter chip switching).

document.addEventListener('DOMContentLoaded', function () {
  // Footer "Cookie Settings" link — lets a visitor re-open the consent banner
  // to change their mind at any time (see cookie-consent.js).
  var cookieSettingsLink = document.getElementById('cookie-settings-link');
  if (cookieSettingsLink) {
    cookieSettingsLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.QuizomaConsent) window.QuizomaConsent.openSettings();
    });
  }

  // PostHog: record the page view, then track every CTA tagged with
  // data-analytics (see analytics.js for the window.Analytics contract).
  if (window.Analytics) {
    window.Analytics.screen('Home');
    document.querySelectorAll('[data-analytics]').forEach(function (el) {
      el.addEventListener('click', function () {
        var props = {};
        if (el.dataset.analyticsProps) {
          try { props = JSON.parse(el.dataset.analyticsProps); } catch (e) {}
        }
        window.Analytics.track(el.dataset.analytics, props);
      });
    });
  }

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
    }, 300000); // 5 minutes — shouldn't feel like it's updating in real time
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
        if (open === item) return;
        open.classList.remove('open');
        var openBtn = open.querySelector('.faq-question');
        if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
      });
      item.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
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

  // Shared by all three tappable slides below (Single Choice, Multiple Correct,
  // True/False) AND the slider's own autoplay: any real tap on any of them should
  // pause the format-switching autoplay for a bit, so a visitor mid-interaction
  // never gets yanked to the next slide.
  var formatAutoplayPausedUntil = 0;

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

  // Hero mini-quiz card, slide 2 (Multiple Correct): tap a row to check/uncheck it.
  // Picking always shows a check — it IS checked, right or wrong — but the row only turns
  // green when it's both picked AND actually correct. A picked wrong row stays neutral
  // rather than turning red: the "zero punitive penalties" pitch shown, not just claimed.
  //
  // Also self-plays like the Single Choice slide (slide 1) so it still feels alive before
  // anyone touches it: checks the correct rows one at a time, holds so the feedback banner
  // is readable, then clears and repeats. A real tap pauses it, same isAuto skip-vibrate
  // convention as slide 1's activateQuizOption.
  var checklistGroup = document.getElementById('demo-checklist');
  if (checklistGroup) {
    var checklistRows = Array.prototype.slice.call(checklistGroup.querySelectorAll('.demo-check-row'));
    var checklistFeedback = document.getElementById('demo-checklist-feedback');
    var checklistFeedbackText = document.getElementById('demo-checklist-feedback-text');
    var checklistFeedbackPoints = document.getElementById('demo-checklist-feedback-points');
    var correctChecklistRows = checklistRows.filter(function (row) { return row.dataset.correct === 'true'; });

    function updateChecklistFeedback() {
      var pickedCorrect = correctChecklistRows.filter(function (row) { return row.classList.contains('is-picked'); }).length;
      var pickedWrong = checklistRows.some(function (row) { return row.dataset.correct !== 'true' && row.classList.contains('is-picked'); });
      var anyPicked = checklistRows.some(function (row) { return row.classList.contains('is-picked'); });

      if (!anyPicked) {
        checklistFeedback.classList.add('feedback-banner-hidden');
        return;
      }
      checklistFeedback.classList.remove('feedback-banner-hidden');
      checklistFeedbackText.textContent = pickedCorrect + ' of ' + correctChecklistRows.length + ' correct' +
        (pickedWrong ? ' — one pick doesn’t match, no penalty' : ' — partial credit enabled');
      // Split-points demo: each correct option worth an even share of 100.
      var points = Math.round((pickedCorrect / correctChecklistRows.length) * 100);
      checklistFeedbackPoints.textContent = '+' + points + ' Pts';
    }

    function setRowPicked(row, picked) {
      row.classList.toggle('is-picked', picked);
      row.setAttribute('aria-pressed', picked ? 'true' : 'false');
    }

    checklistRows.forEach(function (row) {
      row.addEventListener('click', function () {
        formatAutoplayPausedUntil = Date.now() + 8000;
        checklistAutoplayPausedUntil = Date.now() + 8000;
        setRowPicked(row, !row.classList.contains('is-picked'));
        if (navigator.vibrate) navigator.vibrate(15);
        updateChecklistFeedback();
      });
    });

    var checklistReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var checklistAutoplayTimer = null;
    var checklistAutoplayPausedUntil = 0;
    var checklistAutoStep = 0; // 0..N-1 = check the Nth correct row next; N = hold, then reset

    function scheduleChecklistAutoplay() {
      if (checklistReduceMotion) return;
      if (checklistAutoplayTimer) clearTimeout(checklistAutoplayTimer);
      var atRest = checklistAutoStep === 0;
      checklistAutoplayTimer = setTimeout(function () {
        if (Date.now() < checklistAutoplayPausedUntil || document.hidden) {
          scheduleChecklistAutoplay();
          return;
        }
        if (checklistAutoStep >= correctChecklistRows.length) {
          checklistRows.forEach(function (row) { setRowPicked(row, false); });
          updateChecklistFeedback();
          checklistAutoStep = 0;
        } else {
          setRowPicked(correctChecklistRows[checklistAutoStep], true);
          updateChecklistFeedback();
          checklistAutoStep++;
        }
        scheduleChecklistAutoplay();
        // Long pause once both are checked and the banner is showing (readable time);
        // short pause between individual picks (feels like someone actively ticking boxes).
      }, atRest ? 2400 : 900);
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleChecklistAutoplay();
    });

    scheduleChecklistAutoplay();
  }

  // Hero mini-quiz card, slide 3 (True / False): tap either side to answer — only one
  // selection at a time, same correct/incorrect colors as the Single Choice slide so every
  // "pick an answer" slide in the carousel reads as one consistent system. Also self-plays
  // like slide 1: picks the correct side, holds, clears, repeats — pausing on a real tap.
  var tfRow = document.getElementById('demo-tf-row');
  if (tfRow) {
    var tfButtons = Array.prototype.slice.call(tfRow.querySelectorAll('.demo-tf-btn'));

    function clearTfButtons() {
      tfButtons.forEach(function (other) {
        other.classList.remove('is-picked-correct', 'is-picked-incorrect', 'option-pop', 'option-shake');
        other.setAttribute('aria-pressed', 'false');
      });
    }

    function pickTfButton(btn, isAuto) {
      var isCorrect = btn.dataset.correct === 'true';
      clearTfButtons();
      void btn.offsetWidth; // restart the animation if tapped/played again
      btn.classList.add(isCorrect ? 'is-picked-correct' : 'is-picked-incorrect');
      btn.classList.add(isCorrect ? 'option-pop' : 'option-shake');
      btn.setAttribute('aria-pressed', 'true');
      if (!isAuto && navigator.vibrate) navigator.vibrate(isCorrect ? [30, 40, 30] : 60);
    }

    var tfReduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var tfAutoplayTimer = null;
    var tfAutoplayPausedUntil = 0;
    var tfAutoShowing = false; // false = cleared (about to show), true = showing (about to clear)

    function scheduleTfAutoplay() {
      if (tfReduceMotion) return;
      if (tfAutoplayTimer) clearTimeout(tfAutoplayTimer);
      tfAutoplayTimer = setTimeout(function () {
        if (Date.now() < tfAutoplayPausedUntil || document.hidden) {
          scheduleTfAutoplay();
          return;
        }
        if (tfAutoShowing) {
          clearTfButtons();
        } else {
          var correctBtn = tfButtons.filter(function (b) { return b.dataset.correct === 'true'; })[0];
          pickTfButton(correctBtn, true);
        }
        tfAutoShowing = !tfAutoShowing;
        scheduleTfAutoplay();
      }, tfAutoShowing ? 2400 : 1000);
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) scheduleTfAutoplay();
    });

    scheduleTfAutoplay();

    tfButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        formatAutoplayPausedUntil = Date.now() + 8000;
        tfAutoplayPausedUntil = Date.now() + 8000;
        pickTfButton(btn, false);
        btn.setAttribute('aria-pressed', 'true');
        if (navigator.vibrate) navigator.vibrate(isCorrect ? [30, 40, 30] : 60);
      });
    });
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

    // Size each slide to the slider's actual pixel width (not a CSS percentage
    // of the track) so there's no ambiguity about what the track's own width
    // resolves against — recomputed on resize since the card is fluid-width.
    function layoutFormatSlides() {
      var slideWidth = quizSlider.offsetWidth;
      formatSlides.forEach(function (slide) { slide.style.width = slideWidth + 'px'; });
      quizTrack.style.width = (slideWidth * formatSlides.length) + 'px';
      quizTrack.style.transform = 'translateX(-' + (currentFormatSlide * slideWidth) + 'px)';
    }

    function goToFormatSlide(index) {
      currentFormatSlide = index;
      var slideWidth = quizSlider.offsetWidth;
      quizTrack.style.transform = 'translateX(-' + (index * slideWidth) + 'px)';
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

    window.addEventListener('resize', layoutFormatSlides, { passive: true });

    // Manual swipe/drag, on top of the autoplay above — Pointer Events cover touch, mouse
    // and pen with one code path instead of separate touchstart/mousedown handlers.
    var dragStartX = 0, dragStartY = 0, dragDeltaX = 0, dragPointerId = null;
    var dragIntent = null; // null (undecided) | 'horizontal' (we own it) | 'vertical' (let the page scroll)
    var DRAG_INTENT_THRESHOLD = 6; // px of movement before committing to a direction
    var DRAG_COMMIT_THRESHOLD = 0.18; // fraction of slide width to trigger a slide change

    function onDragStart(e) {
      // Ignore a second finger, and ignore the start of a new drag mid-animation.
      if (dragPointerId !== null) return;
      dragPointerId = e.pointerId;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragDeltaX = 0;
      dragIntent = null;
    }

    function onDragMove(e) {
      if (e.pointerId !== dragPointerId) return;
      var dx = e.clientX - dragStartX;
      var dy = e.clientY - dragStartY;

      if (dragIntent === null) {
        if (Math.abs(dx) < DRAG_INTENT_THRESHOLD && Math.abs(dy) < DRAG_INTENT_THRESHOLD) return;
        // Whichever axis moved further decides the gesture — this is what lets a vertical
        // page-scroll swipe pass through untouched instead of fighting the slider.
        dragIntent = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
        if (dragIntent === 'horizontal') {
          quizTrack.classList.add('is-dragging');
          formatAutoplayPausedUntil = Date.now() + 8000;
        }
      }
      if (dragIntent !== 'horizontal') return;

      // Now that we own the gesture, stop the browser from also trying to scroll/select.
      e.preventDefault();
      dragDeltaX = dx;
      var slideWidth = quizSlider.offsetWidth;
      var baseX = -(currentFormatSlide * slideWidth);
      // Rubber-band resistance past the first/last slide, so dragging past either end
      // still moves (feels responsive) but visibly resists (signals "that's the end").
      var atStart = currentFormatSlide === 0 && dx > 0;
      var atEnd = currentFormatSlide === formatSlides.length - 1 && dx < 0;
      var appliedDx = (atStart || atEnd) ? dx * 0.35 : dx;
      quizTrack.style.transform = 'translateX(' + (baseX + appliedDx) + 'px)';
    }

    function onDragEnd(e) {
      if (e.pointerId !== dragPointerId) return;
      dragPointerId = null;
      quizTrack.classList.remove('is-dragging');

      if (dragIntent !== 'horizontal') {
        dragIntent = null;
        return;
      }
      dragIntent = null;

      var slideWidth = quizSlider.offsetWidth;
      var movedFraction = dragDeltaX / slideWidth;
      var next = currentFormatSlide;
      if (movedFraction <= -DRAG_COMMIT_THRESHOLD && currentFormatSlide < formatSlides.length - 1) {
        next = currentFormatSlide + 1;
      } else if (movedFraction >= DRAG_COMMIT_THRESHOLD && currentFormatSlide > 0) {
        next = currentFormatSlide - 1;
      }
      // goToFormatSlide restores the transition and snaps to the resolved slide — same
      // path whether that's the next slide or back to where we started.
      goToFormatSlide(next);
    }

    quizSlider.addEventListener('pointerdown', onDragStart);
    quizSlider.addEventListener('pointermove', onDragMove);
    quizSlider.addEventListener('pointerup', onDragEnd);
    quizSlider.addEventListener('pointercancel', onDragEnd);

    layoutFormatSlides();
    goToFormatSlide(0);
    scheduleFormatAutoplay();
  }
});
