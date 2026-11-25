// android/app/src/main/java/com/chaoticneutral/myco/MainActivity.java
package com.chaoticneutral.myco;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MycoUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
