"use strict";

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

class MapSettingsCard extends FormattingSettingsCard {
    mapStyle = new formattingSettings.ItemDropdown({
        name: "mapStyle",
        displayName: "Map Style",
        items: [
            { value: "dark-v11", displayName: "Dark" },
            { value: "light-v11", displayName: "Light" },
            { value: "satellite-streets-v12", displayName: "Satellite" },
            { value: "navigation-night-v1", displayName: "Navigation Dark" },
            { value: "navigation-day-v1", displayName: "Navigation Light" }
        ],
        value: { value: "dark-v11", displayName: "Dark" }
    });

    mapboxToken = new formattingSettings.TextInput({
        name: "mapboxToken",
        displayName: "Mapbox Access Token",
        value: "",
        placeholder: "pk.eyJ1..."
    });

    name: string = "mapSettings";
    displayName: string = "Map Settings";
    slices: Array<FormattingSettingsSlice> = [this.mapStyle, this.mapboxToken];
}

class FlowSettingsCard extends FormattingSettingsCard {
    arcColor = new formattingSettings.ColorPicker({
        name: "arcColor",
        displayName: "Arc Start Color",
        value: { value: "#00d4ff" }
    });

    arcColorEnd = new formattingSettings.ColorPicker({
        name: "arcColorEnd",
        displayName: "Arc End Color",
        value: { value: "#ff6b35" }
    });

    arcWidth = new formattingSettings.NumUpDown({
        name: "arcWidth",
        displayName: "Arc Width",
        value: 2,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0.5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 20 }
        }
    });

    arcOpacity = new formattingSettings.NumUpDown({
        name: "arcOpacity",
        displayName: "Arc Opacity (%)",
        value: 60,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 5 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    animationSpeed = new formattingSettings.NumUpDown({
        name: "animationSpeed",
        displayName: "Animation Speed",
        value: 50,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    particleSize = new formattingSettings.NumUpDown({
        name: "particleSize",
        displayName: "Particle Size",
        value: 4,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 1 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 15 }
        }
    });

    showAnimation = new formattingSettings.ToggleSwitch({
        name: "showAnimation",
        displayName: "Show Animation",
        value: true
    });

    curveHeight = new formattingSettings.NumUpDown({
        name: "curveHeight",
        displayName: "Curve Height",
        value: 50,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    name: string = "flowSettings";
    displayName: string = "Flow Settings";
    slices: Array<FormattingSettingsSlice> = [
        this.arcColor, this.arcColorEnd, this.arcWidth, this.arcOpacity,
        this.animationSpeed, this.particleSize, this.showAnimation, this.curveHeight
    ];
}

class NodeSettingsCard extends FormattingSettingsCard {
    showNodes = new formattingSettings.ToggleSwitch({
        name: "showNodes",
        displayName: "Show Nodes",
        value: true
    });

    nodeColor = new formattingSettings.ColorPicker({
        name: "nodeColor",
        displayName: "Node Color",
        value: { value: "#ffffff" }
    });

    nodeSize = new formattingSettings.NumUpDown({
        name: "nodeSize",
        displayName: "Node Size",
        value: 6,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 2 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 20 }
        }
    });

    showLabels = new formattingSettings.ToggleSwitch({
        name: "showLabels",
        displayName: "Show Labels",
        value: true
    });

    labelColor = new formattingSettings.ColorPicker({
        name: "labelColor",
        displayName: "Label Color",
        value: { value: "#ffffff" }
    });

    labelSize = new formattingSettings.NumUpDown({
        name: "labelSize",
        displayName: "Label Size",
        value: 11,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 8 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 24 }
        }
    });

    name: string = "nodeSettings";
    displayName: string = "Node Settings";
    slices: Array<FormattingSettingsSlice> = [
        this.showNodes, this.nodeColor, this.nodeSize,
        this.showLabels, this.labelColor, this.labelSize
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    mapSettingsCard = new MapSettingsCard();
    flowSettingsCard = new FlowSettingsCard();
    nodeSettingsCard = new NodeSettingsCard();

    cards = [this.mapSettingsCard, this.flowSettingsCard, this.nodeSettingsCard];
}
