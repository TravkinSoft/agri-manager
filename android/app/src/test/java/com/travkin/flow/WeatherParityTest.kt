package com.travkin.flow

import com.travkin.flow.data.weatherProfileBody
import com.travkin.flow.domain.*
import org.junit.Assert.*
import org.junit.Test

class WeatherParityTest {
    private val point = WeatherPoint("2026-09-04T05:00:00Z", 1.0, 2.0, 0.0, 0.0, 20.0)
    @Test fun `preset limits match web 9ea2c8317aad`() {
        assertEquals(listOf(8.0, 4.0, 6.0, 8.0, 8.0), weatherModes.keys.map { weatherModeProfile(it)!!.maxWindMs })
        assertEquals("forbidden", weatherModeProfile("spraying")!!.precipitationMode)
        assertEquals(0.2, weatherModeProfile("harvest")!!.maxPrecipitationMmH!!, 0.0)
    }
    @Test fun `no profile and disabled criteria are unknown not green`() {
        assertEquals("gray", evaluateOperatingHour(point, null).status)
        assertEquals("gray", evaluateOperatingHour(point, WeatherProfile()).status)
    }
    @Test fun `upper thresholds include exact orange and yellow boundaries`() {
        val profile = WeatherProfile(windEnabled = true, maxWindMs = 10.0)
        assertEquals("green", evaluateOperatingHour(point.copy(wind = 7.49), profile).status)
        assertEquals("yellow", evaluateOperatingHour(point.copy(wind = 7.5), profile).status)
        assertEquals("orange", evaluateOperatingHour(point.copy(wind = 10.0 * 0.92), profile).status)
        assertEquals("orange", evaluateOperatingHour(point.copy(wind = 10.0), profile).status)
        assertEquals("red", evaluateOperatingHour(point.copy(wind = 10.01), profile).status)
    }
    @Test fun `known danger overrides missing weather but unknown overrides warnings`() {
        val profile = weatherModeProfile("general")!!
        assertEquals("red", evaluateOperatingHour(point.copy(wind = 20.0, gust = null), profile).status)
        assertEquals("gray", evaluateOperatingHour(point.copy(wind = 6.0, gust = null), profile).status)
    }
    @Test fun `rain excludes spraying even when wind is calm`() {
        assertEquals("red", evaluateOperatingHour(point.copy(rain = 0.01), weatherModeProfile("spraying")).status)
        assertEquals("green", evaluateOperatingHour(point, weatherModeProfile("spraying")).status)
    }
    @Test fun `working windows split gaps and non-green hours`() {
        val hours = listOf("05", "06", "09", "10", "11").mapIndexed { i, hour ->
            OperatingHour(point.copy(time = "2026-09-04T$hour:00:00Z"), if (i == 3) "yellow" else "green", emptyList())
        }
        val windows = findOperatingWindows(hours)
        assertEquals(listOf(2, 1, 1), windows.map { it.hours })
        assertEquals("2026-09-04T07:00:00Z", windows.first().end)
    }
    @Test fun `profile validation follows server ranges requiredness and temperature order`() {
        val original = WeatherProfile(name = "Профиль")
        assertNull(validateWeatherProfile(original))
        assertNotNull(validateWeatherProfile(original.copy(windEnabled = true)))
        assertNotNull(validateWeatherProfile(original.copy(maxGustMs = 151.0)))
        assertNotNull(validateWeatherProfile(original.copy(maxWindMs = Double.NaN)))
        assertNotNull(validateWeatherProfile(original.copy(temperatureEnabled = true)))
        assertNotNull(validateWeatherProfile(original.copy(minTemperatureC = 20.0, maxTemperatureC = 10.0)))
        assertNull(validateWeatherProfile(original.copy(temperatureEnabled = true, minTemperatureC = 0.0)))
    }
    @Test fun `weather command omits identity and ownership fields`() {
        val body = weatherProfileBody(weatherModeProfile("general")!!.copy(id = "existing", updatedAt = "before"))
        assertFalse(body.has("id"))
        assertFalse(body.has("companyId"))
        assertFalse(body.has("userId"))
        assertFalse(body.has("updatedAt"))
        assertEquals(14, body.size())
    }
}
