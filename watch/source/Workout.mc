import Toybox.Activity;
import Toybox.ActivityRecording;
import Toybox.Lang;
import Toybox.Sensor;

// Records the session as a Garmin strength-training activity, so heart rate,
// calories and training load land in Garmin Connect. Starts when the first
// exercise opens, takes a lap per exercise (and for cardio), and is saved or
// discarded from "Finish workout" in the session menu.
class Workout {
    hidden var rec = null;
    hidden var lapKey = null;

    function initialize() {
    }

    function active() {
        return rec != null && rec.isRecording();
    }

    // Called when an exercise (key = its index) or cardio (:cardio) opens.
    function enter(key) {
        if (!(Toybox has :ActivityRecording)) {
            return;
        }
        if (rec == null) {
            Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
            rec = ActivityRecording.createSession({
                :name => "Iron + Engine",
                :sport => Activity.SPORT_TRAINING,
                :subSport => Activity.SUB_SPORT_STRENGTH_TRAINING
            });
            rec.start();
            lapKey = key;
            return;
        }
        if (!rec.isRecording()) {
            rec.start();
        }
        if (lapKey != key) {
            rec.addLap();
            lapKey = key;
        }
    }

    function heartRate() {
        var info = Activity.getActivityInfo();
        return info == null ? null : info.currentHeartRate;
    }

    // Saves to Garmin Connect (on the next sync) and returns the summary for the server.
    function save() {
        if (rec == null) {
            return null;
        }
        var info = Activity.getActivityInfo();
        var summary = {};
        if (info != null) {
            if (info.timerTime != null) {
                summary["min"] = ((info.timerTime / 60000.0) + 0.5).toNumber();
            }
            if (info.averageHeartRate != null) {
                summary["avgHr"] = info.averageHeartRate;
            }
            if (info.maxHeartRate != null) {
                summary["maxHr"] = info.maxHeartRate;
            }
            if (info.calories != null) {
                summary["kcal"] = info.calories;
            }
        }
        if (rec.isRecording()) {
            rec.stop();
        }
        rec.save();
        rec = null;
        lapKey = null;
        return summary;
    }

    function discard() {
        if (rec == null) {
            return;
        }
        if (rec.isRecording()) {
            rec.stop();
        }
        rec.discard();
        rec = null;
        lapKey = null;
    }
}
