package com.travkin.flow

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.travkin.flow.ui.AppViewModel
import com.travkin.flow.ui.TravkinFlowApp
import com.travkin.flow.ui.theme.TravkinFlowTheme

class MainActivity : ComponentActivity() {
    private val viewModel: AppViewModel by viewModels { AppViewModel.Factory(applicationContext) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TravkinFlowTheme {
                TravkinFlowApp(viewModel)
            }
        }
        routeDashboardLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        routeDashboardLink(intent)
    }

    private fun routeDashboardLink(intent: Intent?) {
        val uri = intent?.data ?: return
        val trustedHost = uri.host == "travkinflow.com" || uri.host == "qa.travkinflow.com"
        if (uri.scheme == "https" && trustedHost && uri.path == "/dashboard") {
            viewModel.openDashboard()
        }
    }
}
