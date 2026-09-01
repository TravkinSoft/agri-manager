package com.travkin.flow

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
    }
}
