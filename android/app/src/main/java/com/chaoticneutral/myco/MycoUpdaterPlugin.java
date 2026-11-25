// android/app/src/main/java/com/chaoticneutral/myco/MycoUpdaterPlugin.java
package com.chaoticneutral.myco;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "MycoUpdater")
public class MycoUpdaterPlugin extends Plugin {
    private static final Pattern RELEASE = Pattern.compile(
        "^https://github\\.com/ChaoticNeutralMyco/mushroom-tracker-app/releases/download/v([0-9]{1,8}\\.[0-9]{1,8}\\.[0-9]{1,8})/MycoTracker-\\1-Android\\.apk$");

    @PluginMethod
    public void openDownload(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !RELEASE.matcher(url).matches()) {
            call.reject("Unrecognized update download URL.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject("No browser could open the update download.");
            }
        });
    }
}
