package com.travkin.flow.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Agriculture
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.travkin.flow.domain.Actor

private val AppBackground = Color(0xFF071019)
private val Surface = Color(0xFF111B26)
private val SurfaceAccent = Color(0xFF172536)
private val BrandGold = Color(0xFFF2C94C)
private val Success = Color(0xFF61D6A8)
private val Muted = Color(0xFF9EADBC)

@Composable
fun TravkinFlowApp(viewModel: AppViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(AppBackground, Color(0xFF0B1622)),
                ),
            )
            .safeDrawingPadding(),
    ) {
        when (val current = state) {
            AppUiState.Booting -> BootScreen()
            is AppUiState.SignedOut -> LoginScreen(
                state = current,
                onSignIn = viewModel::signIn,
            )
            is AppUiState.SignedIn -> AgronomistCabinet(
                state = current,
                onRefresh = viewModel::refresh,
                onSignOut = viewModel::signOut,
            )
        }
    }
}

@Composable
private fun BootScreen() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Outlined.Agriculture, contentDescription = null, tint = BrandGold)
        Spacer(Modifier.height(16.dp))
        Text("TravkinFlow", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        CircularProgressIndicator(color = BrandGold)
    }
}

@Composable
private fun LoginScreen(
    state: AppUiState.SignedOut,
    onSignIn: (String, String) -> Unit,
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    val submit = { if (!state.signingIn) onSignIn(email, password) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(horizontal = 24.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Outlined.Agriculture, contentDescription = null, tint = BrandGold)
        Spacer(Modifier.height(16.dp))
        Text("TravkinFlow", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
        Text("Мобильный кабинет Агронома", color = Muted)
        Spacer(Modifier.height(28.dp))

        Card(
            colors = CardDefaults.cardColors(containerColor = Surface),
            shape = RoundedCornerShape(24.dp),
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text("Вход", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Email") },
                    singleLine = true,
                    enabled = !state.signingIn,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Email,
                        imeAction = ImeAction.Next,
                    ),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Пароль") },
                    leadingIcon = { Icon(Icons.Outlined.Lock, contentDescription = null) },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    enabled = !state.signingIn,
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                    ),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                )
                state.message?.let { MessageCard(it) }
                Button(
                    onClick = submit,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !state.signingIn && email.isNotBlank() && password.isNotBlank(),
                ) {
                    if (state.signingIn) {
                        CircularProgressIndicator(
                            modifier = Modifier.height(20.dp),
                            strokeWidth = 2.dp,
                        )
                    } else {
                        Text("Войти как Агроном")
                    }
                }
            }
        }
    }
}

@Composable
private fun AgronomistCabinet(
    state: AppUiState.SignedIn,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column {
                Text("TravkinFlow", color = BrandGold, fontWeight = FontWeight.Bold)
                Text("Кабинет Агронома", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
            Icon(Icons.Outlined.Agriculture, contentDescription = null, tint = BrandGold)
        }

        Card(
            colors = CardDefaults.cardColors(containerColor = SurfaceAccent),
            shape = RoundedCornerShape(24.dp),
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Outlined.VerifiedUser, contentDescription = null, tint = Success)
                    Text("Доступ подтверждён", fontWeight = FontWeight.SemiBold, color = Success)
                }
                Text(
                    if (state.actorStale) "Показан последний защищённый профиль. Обновите при появлении сети."
                    else "Роль и контекст получены от TravkinFlow.",
                    color = Muted,
                )
                HorizontalDivider(color = Color.White.copy(alpha = 0.08f))
                ActorDetails(state.actor)
            }
        }

        Card(
            colors = CardDefaults.cardColors(containerColor = Surface),
            shape = RoundedCornerShape(24.dp),
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Первый мобильный этап", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(
                    "Сейчас доступен основной защищённый кабинет Агронома. Рабочие разделы будут добавляться по одному после отдельной приёмки каждого этапа.",
                    color = Muted,
                )
            }
        }

        state.message?.let { MessageCard(it) }

        OutlinedButton(
            onClick = onRefresh,
            modifier = Modifier.fillMaxWidth(),
            enabled = !state.refreshing,
        ) {
            if (state.refreshing) {
                CircularProgressIndicator(modifier = Modifier.height(20.dp), strokeWidth = 2.dp)
            } else {
                Icon(Icons.Outlined.Refresh, contentDescription = null)
                Text("  Обновить профиль")
            }
        }
        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) {
            Text("Выйти")
        }
    }
}

@Composable
private fun ActorDetails(actor: Actor) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        DetailRow("Роль", actor.role.displayName)
        DetailRow("Email", actor.email ?: "Не указан")
        DetailRow("Компания", actor.companyId ?: "Контекст не назначен")
    }
}

@Composable
private fun DetailRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Muted)
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun MessageCard(message: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF332A16)),
        shape = RoundedCornerShape(16.dp),
    ) {
        Text(message, modifier = Modifier.padding(14.dp), color = Color(0xFFFFE29A))
    }
}
