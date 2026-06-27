#pragma once

#include <cstdint>
#include <optional>
#include <string>

namespace airboat::nmea {

struct NmeaStatus {
    bool online = false;
    std::string source = "unavailable";
    std::int64_t last_frame_age_ms = 0;
    std::string updated_at;
};

struct PositionState {
    bool valid = false;
    std::optional<double> lat;
    std::optional<double> lon;
    std::int64_t age_ms = 0;
    std::string updated_at;
};

struct MotionState {
    bool valid = false;
    std::optional<double> sog_mps;
    std::optional<double> sog_kmh;
    std::optional<double> cog_deg;
    std::optional<double> heading_deg;
    std::string updated_at;
};

struct DepthState {
    bool valid = false;
    std::optional<double> depth_m;
    std::string updated_at;
};

struct EngineState {
    bool rpm_valid = false;
    std::optional<int> rpm;
    bool fuel_rate_valid = false;
    std::optional<double> fuel_rate_lph;
    std::string updated_at;
};

struct SensorState {
    NmeaStatus nmea;
    PositionState position;
    MotionState motion;
    DepthState depth;
    EngineState engine;
};

}  // namespace airboat::nmea
