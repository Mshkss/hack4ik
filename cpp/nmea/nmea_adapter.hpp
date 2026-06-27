#pragma once

#include <string>

#include "sensor_state.hpp"

namespace airboat::nmea {

class NmeaAdapter {
public:
    virtual ~NmeaAdapter() = default;
    virtual SensorState read() = 0;
};

class CanboatJsonAdapter final : public NmeaAdapter {
public:
    explicit CanboatJsonAdapter(std::string input_path);

    SensorState read() override;

private:
    std::string input_path_;
};

SensorState offline_sensor_state(const std::string& source, const std::string& reason);

}  // namespace airboat::nmea
