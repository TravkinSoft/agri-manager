package com.travkin.flow;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class NativeRoutePolicyTest {
    @Test
    public void routesProductionDeepLinkToQaInDebugContract() {
        assertEquals(
                "https://qa.travkinflow.com/weighbridge?ticket=abc",
                NativeRoutePolicy.normalizeDeepLink(
                        "https://travkinflow.com/weighbridge?ticket=abc",
                        "https://qa.travkinflow.com"
                )
        );
    }

    @Test
    public void allowsAndroidV1Routes() {
        assertTrue(NativeRoutePolicy.isAllowedPath("/dashboard"));
        assertTrue(NativeRoutePolicy.isAllowedPath("/weather-lab"));
        assertTrue(NativeRoutePolicy.isAllowedPath("/fields/field-15"));
        assertTrue(NativeRoutePolicy.isAllowedPath("/warehouses/warehouse-1"));
        assertTrue(NativeRoutePolicy.isAllowedPath("/tickets/ticket-1"));
    }

    @Test
    public void rejectsExternalAndSecondaryRoutes() {
        assertNull(NativeRoutePolicy.normalizeDeepLink(
                "https://example.com/weighbridge",
                "https://qa.travkinflow.com"
        ));
        assertNull(NativeRoutePolicy.normalizeDeepLink(
                "https://travkinflow.com/operations",
                "https://qa.travkinflow.com"
        ));
    }
}
