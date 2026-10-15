import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

// Weight, reps and "to failure" of one set. The target is the exercise screen
// (the next set) or a LoggedSet (fixing one already done); both have kg, reps,
// fail and changed().
class EditMenu extends WatchUi.Menu2 {
    function initialize(target, title) {
        Menu2.initialize({:title => title});
        addItem(new WatchUi.MenuItem("Weight", kgLabel(target.kg), :kg, null));
        addItem(new WatchUi.MenuItem("Reps", target.reps, :reps, null));
        addItem(new WatchUi.ToggleMenuItem("To failure", null, :fail, target.fail, null));
    }
}

function kgLabel(kg) {
    return kg.length() > 0 ? kg + " kg" : "none";
}

class EditMenuDelegate extends WatchUi.Menu2InputDelegate {
    hidden var target;
    hidden var editor;

    function initialize(t, m) {
        Menu2InputDelegate.initialize();
        target = t;
        editor = new SetEditor(t, m);
    }

    function onSelect(item) {
        var id = item.getId();
        if (id == :kg) {
            editor.editKg();
        } else if (id == :reps) {
            editor.editReps();
        } else if (id == :fail) {
            target.fail = (item as WatchUi.ToggleMenuItem).isEnabled();
            target.changed();
        }
    }
}

// Opens the keypad for a set's kg or reps. Used from the edit menu and by tapping
// the weight or reps on the exercise screen (menu is null then).
class SetEditor {
    hidden var target;
    hidden var menu;

    function initialize(t, m) {
        target = t;
        menu = m;
    }

    function editKg() {
        push(new KeypadView("kg", target.kg, true, method(:onKg)));
    }

    function editReps() {
        push(new KeypadView("reps", target.reps, false, method(:onReps)));
    }

    function onKg(value) as Void {
        target.kg = value.length() > 0 ? formatNumber(value.toFloat()) : "";
        if (menu != null) {
            menu.getItem(0).setSubLabel(kgLabel(target.kg));
        }
        target.changed();
    }

    // An empty entry keeps the old reps.
    function onReps(value) as Void {
        if (value.length() == 0) {
            return;
        }
        target.reps = value.toNumber().toString();
        if (menu != null) {
            menu.getItem(1).setSubLabel(target.reps);
        }
        target.changed();
    }

    function push(pad) {
        WatchUi.pushView(pad, new KeypadDelegate(pad), WatchUi.SLIDE_UP);
    }
}

// A set that's already logged: edits are saved and uploaded again (the server
// replaces that set, keeping its time and heart rate).
class LoggedSet {
    var kg;
    var reps;
    var fail;
    hidden var li;
    hidden var si;

    function initialize(liftIndex, setIndex) {
        li = liftIndex;
        si = setIndex;
        var s = getApp().session["lifts"][li]["logged"][si];
        kg = s["kg"] == null ? "" : s["kg"].toString();
        reps = s["reps"] == null ? "" : s["reps"].toString();
        fail = s["fail"] == true;
    }

    function changed() {
        getApp().fixSet(li, si, kg, reps, fail);
        WatchUi.requestUpdate();
    }
}

// 40.0 -> "40", 42.5 -> "42.5"
function formatNumber(value) {
    var f = value.toFloat();
    if (f == f.toNumber().toFloat()) {
        return f.toNumber().toString();
    }
    return f.format("%.1f");
}
