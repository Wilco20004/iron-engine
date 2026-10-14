import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

// How-to for one exercise, one page at a time in large text: what it is, then
// each step. Swipe up or tap for the next page, swipe down for the previous.
class InfoView extends WatchUi.View {
    hidden var pages = [];
    hidden var titles = [];
    hidden var page = 0;

    function initialize(lift) {
        View.initialize();
        var what = lift["what"];
        if (what != null && what.length() > 0) {
            pages.add(what);
            titles.add(shortName(lift["name"]));
        }
        var steps = lift["steps"];
        for (var i = 0; i < steps.size(); i++) {
            pages.add(steps[i]);
            titles.add("Step " + (i + 1) + " of " + steps.size());
        }
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        Theme.clear(dc);

        dc.setColor(Theme.ACCENT, Graphics.COLOR_TRANSPARENT);
        fitText(dc, w / 2, h * 0.16, w * 0.6, titles[page]);

        var area = new WatchUi.TextArea({
            :text => pages[page],
            :color => Graphics.COLOR_WHITE,
            :font => [Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY],
            :justification => Graphics.TEXT_JUSTIFY_CENTER,
            :locX => w * 0.12,
            :locY => h * 0.26,
            :width => w * 0.76,
            :height => h * 0.52
        });
        area.draw(dc);

        Theme.dots(dc, w / 2, h * 0.87, pages.size(), page, Theme.ACCENT);
    }

    function turn(delta) {
        var p = page + delta;
        if (p >= 0 && p < pages.size()) {
            page = p;
            WatchUi.requestUpdate();
        } else if (p >= pages.size()) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
        }
    }
}

class InfoDelegate extends WatchUi.BehaviorDelegate {
    hidden var view;

    function initialize(v) {
        BehaviorDelegate.initialize();
        view = v;
    }

    function onSelect() {
        view.turn(1);
        return true;
    }

    function onNextPage() {
        view.turn(1);
        return true;
    }

    function onPreviousPage() {
        view.turn(-1);
        return true;
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}

// Start and finish photos for one exercise, fetched from /watch/photo and sized
// to the screen by the phone. Tap (or swipe) to switch between the two.
class PhotoView extends WatchUi.View {
    hidden var photo;
    hidden var which = 0;
    hidden var images = [null, null];
    hidden var failed = [false, false];

    function initialize(name) {
        View.initialize();
        photo = name;
    }

    function onShow() {
        load();
    }

    function load() {
        if (images[which] != null || failed[which]) {
            return;
        }
        var app = getApp();
        var size = System.getDeviceSettings().screenWidth * 0.62;
        Communications.makeImageRequest(
            app.baseUrl() + "/watch/photo/" + photo + "-" + which + ".jpg",
            {"key" => app.watchKey()},
            {:maxWidth => size.toNumber(), :maxHeight => size.toNumber()},
            which == 0 ? method(:onStartImage) : method(:onFinishImage)
        );
    }

    function onStartImage(code as Number, data as WatchUi.BitmapResource or Graphics.BitmapReference or Null) as Void {
        got(0, code, data);
    }

    function onFinishImage(code as Number, data as WatchUi.BitmapResource or Graphics.BitmapReference or Null) as Void {
        got(1, code, data);
    }

    function got(i, code, data) {
        if (code == 200 && data != null) {
            images[i] = data;
        } else {
            failed[i] = true;
        }
        WatchUi.requestUpdate();
    }

    function onUpdate(dc) {
        var w = dc.getWidth();
        var h = dc.getHeight();
        Theme.clear(dc);

        Theme.text(dc, w / 2, h * 0.11, Graphics.FONT_SMALL, Theme.ACCENT, which == 0 ? "Start" : "Finish");

        var img = images[which];
        if (img != null) {
            dc.drawBitmap((w - img.getWidth()) / 2, (h - img.getHeight()) / 2 + h * 0.02, img);
        } else {
            Theme.text(dc, w / 2, h / 2, Graphics.FONT_SMALL, Theme.MUTED, failed[which] ? "No photo" : "Loading...");
        }

        Theme.dots(dc, w / 2, h * 0.9, 2, which, Theme.ACCENT);
    }

    function swap() {
        which = 1 - which;
        load();
        WatchUi.requestUpdate();
    }
}

class PhotoDelegate extends WatchUi.BehaviorDelegate {
    hidden var view;

    function initialize(v) {
        BehaviorDelegate.initialize();
        view = v;
    }

    function onSelect() {
        view.swap();
        return true;
    }

    function onNextPage() {
        view.swap();
        return true;
    }

    function onPreviousPage() {
        view.swap();
        return true;
    }

    function onBack() {
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
        return true;
    }
}
